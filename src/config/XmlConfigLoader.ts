/**
 * Lightweight XML parser and config loader for Hazelcast XML config format.
 *
 * Bun does not ship a built-in XML parser, so this file provides a minimal
 * SAX-like tokenizer sufficient to handle the subset of XML used by Hazelcast
 * config files:
 *   - Opening tags with zero or more attributes  (<tag attr="value">)
 *   - Self-closing tags                          (<tag />)
 *   - Closing tags                               (</tag>)
 *   - Text content between tags
 *   - XML declaration                            (<?xml ...?>)
 *   - Comments                                   (<!-- ... -->)
 *
 * The output is a plain JavaScript object tree that mirrors the JSON/YAML
 * config shape accepted by {@link parseRawConfig} in ConfigLoader.
 *
 * Supported Hazelcast XML root elements:
 *   cluster-name, network (port, join/multicast, join/tcp-ip), map, security
 */

// ── Token types ────────────────────────────────────────────────────────────────

interface OpenTag {
    kind: 'open';
    name: string;
    attrs: Record<string, string>;
    selfClosing: boolean;
}

interface CloseTag {
    kind: 'close';
    name: string;
}

interface TextToken {
    kind: 'text';
    value: string;
}

type XmlToken = OpenTag | CloseTag | TextToken;

// ── Tokenizer ─────────────────────────────────────────────────────────────────

/**
 * Tokenize an XML string into a flat array of tokens.
 * Not a general-purpose parser — handles the Hazelcast XML config subset only.
 */
function tokenize(xml: string): XmlToken[] {
    const tokens: XmlToken[] = [];
    let i = 0;
    const len = xml.length;

    while (i < len) {
        if (xml[i] !== '<') {
            // Text content
            const start = i;
            while (i < len && xml[i] !== '<') i++;
            const text = xml.slice(start, i).trim();
            if (text.length > 0) {
                tokens.push({ kind: 'text', value: unescapeXml(text) });
            }
            continue;
        }

        // We're at '<'
        i++; // consume '<'

        if (i >= len) break;

        // XML declaration: <?...?>
        if (xml[i] === '?') {
            const end = xml.indexOf('?>', i);
            i = end === -1 ? len : end + 2;
            continue;
        }

        // Comment: <!-- ... -->
        if (xml.slice(i, i + 3) === '!--') {
            const end = xml.indexOf('-->', i);
            i = end === -1 ? len : end + 3;
            continue;
        }

        // DOCTYPE / CDATA etc. — skip
        if (xml[i] === '!') {
            const end = xml.indexOf('>', i);
            i = end === -1 ? len : end + 1;
            continue;
        }

        // Closing tag: </name>
        if (xml[i] === '/') {
            i++; // consume '/'
            const start = i;
            while (i < len && xml[i] !== '>') i++;
            const name = xml.slice(start, i).trim();
            i++; // consume '>'
            tokens.push({ kind: 'close', name });
            continue;
        }

        // Opening tag (potentially self-closing): <name attr="value" ... >
        const tagStart = i;
        while (i < len && xml[i] !== '>' && xml[i] !== '/' && !/\s/.test(xml[i])) i++;
        const tagName = xml.slice(tagStart, i).trim();

        // Parse attributes
        const attrs: Record<string, string> = {};
        while (i < len && xml[i] !== '>' && xml[i] !== '/') {
            // skip whitespace
            while (i < len && /\s/.test(xml[i])) i++;
            if (xml[i] === '>' || xml[i] === '/') break;

            // Attribute name
            const attrStart = i;
            while (i < len && xml[i] !== '=' && xml[i] !== '>' && xml[i] !== '/' && !/\s/.test(xml[i])) i++;
            const attrName = xml.slice(attrStart, i).trim();

            // skip whitespace
            while (i < len && /\s/.test(xml[i])) i++;

            if (xml[i] === '=') {
                i++; // consume '='
                // skip whitespace
                while (i < len && /\s/.test(xml[i])) i++;
                let attrValue = '';
                if (xml[i] === '"' || xml[i] === "'") {
                    const quote = xml[i];
                    i++; // consume opening quote
                    const valStart = i;
                    while (i < len && xml[i] !== quote) i++;
                    attrValue = unescapeXml(xml.slice(valStart, i));
                    i++; // consume closing quote
                } else {
                    // Unquoted attribute value (rare in Hazelcast XML but handle it)
                    const valStart = i;
                    while (i < len && !/[\s>]/.test(xml[i])) i++;
                    attrValue = unescapeXml(xml.slice(valStart, i));
                }
                if (attrName.length > 0) {
                    attrs[attrName] = attrValue;
                }
            } else if (attrName.length > 0) {
                // Boolean attribute with no value
                attrs[attrName] = attrName;
            }
        }

        let selfClosing = false;
        if (i < len && xml[i] === '/') {
            selfClosing = true;
            i++; // consume '/'
        }
        if (i < len && xml[i] === '>') {
            i++; // consume '>'
        }

        if (tagName.length > 0) {
            tokens.push({ kind: 'open', name: tagName, attrs, selfClosing });
            if (selfClosing) {
                tokens.push({ kind: 'close', name: tagName });
            }
        }
    }

    return tokens;
}

/** Unescape the five predefined XML entities. */
function unescapeXml(s: string): string {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

// ── DOM-like tree builder ─────────────────────────────────────────────────────

interface XmlElement {
    name: string;
    attrs: Record<string, string>;
    children: XmlElement[];
    text: string;
}

function buildTree(tokens: XmlToken[]): XmlElement {
    const root: XmlElement = { name: '__root__', attrs: {}, children: [], text: '' };
    const stack: XmlElement[] = [root];

    for (const token of tokens) {
        const parent = stack[stack.length - 1];
        if (token.kind === 'open') {
            const el: XmlElement = { name: token.name, attrs: token.attrs, children: [], text: '' };
            parent.children.push(el);
            if (!token.selfClosing) {
                stack.push(el);
            }
        } else if (token.kind === 'close') {
            if (stack.length > 1 && stack[stack.length - 1].name === token.name) {
                stack.pop();
            }
        } else if (token.kind === 'text') {
            parent.text = token.value;
        }
    }

    return root;
}

// ── Config converter ──────────────────────────────────────────────────────────

/**
 * Find the first child element with the given tag name (case-insensitive).
 */
function child(el: XmlElement, tag: string): XmlElement | undefined {
    const lower = tag.toLowerCase();
    return el.children.find((c) => c.name.toLowerCase() === lower);
}

/**
 * Find all child elements with the given tag name (case-insensitive).
 */
function children(el: XmlElement, tag: string): XmlElement[] {
    const lower = tag.toLowerCase();
    return el.children.filter((c) => c.name.toLowerCase() === lower);
}

/**
 * Return the trimmed text content of an element, or a fallback string.
 */
function text(el: XmlElement | undefined, fallback: string): string {
    return el?.text?.trim() || fallback;
}

/**
 * Convert the Hazelcast XML element tree to the raw config object shape that
 * {@link parseRawConfig} in ConfigLoader.ts expects.
 */
function xmlToRaw(hazelcastEl: XmlElement): Record<string, unknown> {
    const raw: Record<string, unknown> = {};

    // <cluster-name>
    const clusterNameEl = child(hazelcastEl, 'cluster-name');
    if (clusterNameEl) {
        raw['name'] = text(clusterNameEl, 'helios');
    }

    // <network>
    const networkEl = child(hazelcastEl, 'network');
    if (networkEl) {
        raw['network'] = parseNetworkElement(networkEl);
    }

    // <map name="..."> — may appear multiple times
    const mapEls = children(hazelcastEl, 'map');
    if (mapEls.length > 0) {
        raw['maps'] = mapEls.map(parseMapElement);
    }

    // <security>
    const securityEl = child(hazelcastEl, 'security');
    if (securityEl) {
        raw['security'] = parseSecurityElement(securityEl);
    }

    return raw;
}

function parseNetworkElement(el: XmlElement): Record<string, unknown> {
    const network: Record<string, unknown> = {};

    // <port auto-increment="true">5701</port>
    const portEl = child(el, 'port');
    if (portEl) {
        const portNum = parseInt(portEl.text.trim(), 10);
        if (!isNaN(portNum)) {
            network['port'] = portNum;
        }
    }

    // <join>
    const joinEl = child(el, 'join');
    if (joinEl) {
        network['join'] = parseJoinElement(joinEl);
    }

    return network;
}

function parseJoinElement(el: XmlElement): Record<string, unknown> {
    const join: Record<string, unknown> = {};

    // <multicast enabled="true">
    const multicastEl = child(el, 'multicast');
    if (multicastEl) {
        const mc: Record<string, unknown> = {};

        const enabledAttr = multicastEl.attrs['enabled'];
        if (enabledAttr !== undefined) {
            mc['enabled'] = enabledAttr === 'true';
        }

        const groupEl = child(multicastEl, 'multicast-group');
        if (groupEl) {
            mc['multicast-group'] = text(groupEl, '224.2.2.3');
        }

        const portEl = child(multicastEl, 'multicast-port');
        if (portEl) {
            const p = parseInt(portEl.text.trim(), 10);
            if (!isNaN(p)) mc['multicast-port'] = p;
        }

        join['multicast'] = mc;
    }

    // <tcp-ip enabled="false">
    const tcpIpEl = child(el, 'tcp-ip');
    if (tcpIpEl) {
        const tc: Record<string, unknown> = {};

        const enabledAttr = tcpIpEl.attrs['enabled'];
        if (enabledAttr !== undefined) {
            tc['enabled'] = enabledAttr === 'true';
        }

        // <member-list><member>...</member></member-list>
        const memberListEl = child(tcpIpEl, 'member-list');
        const memberEls = memberListEl
            ? children(memberListEl, 'member')
            : children(tcpIpEl, 'member');

        if (memberEls.length > 0) {
            tc['members'] = memberEls.map((m) => m.text.trim()).filter(Boolean);
        }

        join['tcp-ip'] = tc;
    }

    return join;
}

function parseMapElement(el: XmlElement): Record<string, unknown> {
    const mc: Record<string, unknown> = {};

    // name attribute: <map name="default">
    const name = el.attrs['name']?.trim();
    if (name) mc['name'] = name;

    const backupEl = child(el, 'backup-count');
    if (backupEl) {
        const n = parseInt(backupEl.text.trim(), 10);
        if (!isNaN(n)) mc['backupCount'] = n;
    }

    const ttlEl = child(el, 'time-to-live-seconds');
    if (ttlEl) {
        const n = parseInt(ttlEl.text.trim(), 10);
        if (!isNaN(n)) mc['ttlSeconds'] = n;
    }

    const maxIdleEl = child(el, 'max-idle-seconds');
    if (maxIdleEl) {
        const n = parseInt(maxIdleEl.text.trim(), 10);
        if (!isNaN(n)) mc['maxIdleSeconds'] = n;
    }

    const asyncBackupEl = child(el, 'async-backup-count');
    if (asyncBackupEl) {
        const n = parseInt(asyncBackupEl.text.trim(), 10);
        if (!isNaN(n)) mc['asyncBackupCount'] = n;
    }

    const statsEl = child(el, 'statistics-enabled');
    if (statsEl) {
        mc['statisticsEnabled'] = statsEl.text.trim() === 'true';
    }

    const readBackupEl = child(el, 'read-backup-data');
    if (readBackupEl) {
        mc['readBackupData'] = readBackupEl.text.trim() === 'true';
    }

    return mc;
}

function parseSecurityElement(el: XmlElement): Record<string, unknown> {
    const sec: Record<string, unknown> = {};

    const enabledEl = child(el, 'enabled');
    if (enabledEl) {
        sec['enabled'] = enabledEl.text.trim() === 'true';
    } else if (el.attrs['enabled'] !== undefined) {
        sec['enabled'] = el.attrs['enabled'] === 'true';
    }

    const memberRealmEl = child(el, 'member-realm');
    if (memberRealmEl) {
        sec['member-realm'] = text(memberRealmEl, '');
    }

    const clientRealmEl = child(el, 'client-realm');
    if (clientRealmEl) {
        sec['client-realm'] = text(clientRealmEl, '');
    }

    return sec;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a Hazelcast XML config string and return a raw config object that is
 * compatible with the shape expected by {@link parseRawConfig} in ConfigLoader.
 *
 * @throws Error if the XML cannot be parsed or contains no root element.
 */
export function parseXml(xmlString: string): Record<string, unknown> {
    const tokens = tokenize(xmlString);
    const root = buildTree(tokens);

    // Find the <hazelcast> root element
    const hazelcastEl = root.children.find(
        (c) => c.name.toLowerCase() === 'hazelcast',
    );

    if (!hazelcastEl) {
        throw new Error(
            'Invalid Hazelcast XML config: no <hazelcast> root element found',
        );
    }

    return xmlToRaw(hazelcastEl);
}

/**
 * Hazelcast XML config loader.
 *
 * Converts a Hazelcast XML config string into the same raw config object that
 * the JSON/YAML loaders produce, which is then fed into {@link parseRawConfig}.
 */
export class XmlConfigLoader {
    /**
     * Parse a Hazelcast XML config string and return the raw config object.
     *
     * @param xmlString The full content of a hazelcast.xml file.
     * @returns Raw config object compatible with {@link parseRawConfig}.
     * @throws Error if the XML is structurally invalid.
     */
    static parseXml(xmlString: string): Record<string, unknown> {
        return parseXml(xmlString);
    }
}
