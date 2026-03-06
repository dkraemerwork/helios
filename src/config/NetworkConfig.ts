import { JoinConfig } from '@zenystx/core/config/JoinConfig';
import { InterfacesConfig } from '@zenystx/core/config/InterfacesConfig';
import { RestApiConfig } from '@zenystx/core/config/RestApiConfig';
import { MemcacheProtocolConfig } from '@zenystx/core/config/MemcacheProtocolConfig';

export class NetworkConfig {
    static readonly DEFAULT_PORT = 5701;
    static readonly PORT_MAX = 0xFFFF;

    private _port: number = NetworkConfig.DEFAULT_PORT;
    private _portCount: number = 100;
    private _portAutoIncrement: boolean = true;
    private _reuseAddress: boolean = true;
    private _publicAddress: string | null = null;
    private _interfaces: InterfacesConfig = new InterfacesConfig();
    private _join: JoinConfig = new JoinConfig();
    private _outboundPortDefinitions: string[] = [];
    private _outboundPorts: number[] = [];
    private _restApiConfig: RestApiConfig = new RestApiConfig();
    private _memcacheProtocolConfig: MemcacheProtocolConfig = new MemcacheProtocolConfig();

    getPort(): number {
        return this._port;
    }

    setPort(port: number): this {
        if (port < 0) {
            throw new Error(`port must be >= 0, was: ${port}`);
        }
        if (port > NetworkConfig.PORT_MAX) {
            throw new Error(`port must be <= ${NetworkConfig.PORT_MAX}, was: ${port}`);
        }
        this._port = port;
        return this;
    }

    getPortCount(): number {
        return this._portCount;
    }

    setPortCount(portCount: number): this {
        if (portCount < 0) {
            throw new Error(`portCount must be >= 0, was: ${portCount}`);
        }
        this._portCount = portCount;
        return this;
    }

    isPortAutoIncrement(): boolean {
        return this._portAutoIncrement;
    }

    setPortAutoIncrement(portAutoIncrement: boolean): this {
        this._portAutoIncrement = portAutoIncrement;
        return this;
    }

    isReuseAddress(): boolean {
        return this._reuseAddress;
    }

    setReuseAddress(reuseAddress: boolean): this {
        this._reuseAddress = reuseAddress;
        return this;
    }

    getPublicAddress(): string | null {
        return this._publicAddress;
    }

    setPublicAddress(publicAddress: string): this {
        this._publicAddress = publicAddress;
        return this;
    }

    getInterfaces(): InterfacesConfig {
        return this._interfaces;
    }

    setInterfaces(interfaces: InterfacesConfig): this {
        this._interfaces = interfaces;
        return this;
    }

    getJoin(): JoinConfig {
        return this._join;
    }

    setJoin(join: JoinConfig): this {
        this._join = join;
        return this;
    }

    getOutboundPortDefinitions(): string[] {
        return this._outboundPortDefinitions;
    }

    setOutboundPortDefinitions(outboundPortDefinitions: string[]): this {
        this._outboundPortDefinitions = outboundPortDefinitions;
        return this;
    }

    addOutboundPortDefinition(portDef: string): this {
        this._outboundPortDefinitions.push(portDef);
        return this;
    }

    getOutboundPorts(): number[] {
        return this._outboundPorts;
    }

    setOutboundPorts(outboundPorts: number[]): this {
        this._outboundPorts = outboundPorts;
        return this;
    }

    addOutboundPort(port: number): this {
        this._outboundPorts.push(port);
        return this;
    }

    getRestApiConfig(): RestApiConfig {
        return this._restApiConfig;
    }

    setRestApiConfig(restApiConfig: RestApiConfig): this {
        this._restApiConfig = restApiConfig;
        return this;
    }

    getMemcacheProtocolConfig(): MemcacheProtocolConfig {
        return this._memcacheProtocolConfig;
    }

    setMemcacheProtocolConfig(memcacheProtocolConfig: MemcacheProtocolConfig): this {
        this._memcacheProtocolConfig = memcacheProtocolConfig;
        return this;
    }
}
