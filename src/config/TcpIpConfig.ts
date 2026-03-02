const MEMBER_TEXT_SPLIT_PATTERN = /[,; ]+/;

export class TcpIpConfig {
    private static readonly DEFAULT_CONNECTION_TIMEOUT_SECONDS = 5;

    private _enabled: boolean = false;
    private _members: string[] = [];
    private _connectionTimeoutSeconds: number = TcpIpConfig.DEFAULT_CONNECTION_TIMEOUT_SECONDS;
    private _requiredMember: string | null = null;

    isEnabled(): boolean {
        return this._enabled;
    }

    setEnabled(enabled: boolean): this {
        this._enabled = enabled;
        return this;
    }

    getMembers(): string[] {
        return [...this._members];
    }

    setMembers(members: string[]): this {
        this._members = [];
        for (const member of members) {
            const parts = member.split(MEMBER_TEXT_SPLIT_PATTERN).filter(s => s.length > 0);
            this._members.push(...parts);
        }
        return this;
    }

    addMember(memberText: string): this {
        const parts = memberText.split(MEMBER_TEXT_SPLIT_PATTERN).filter(s => s.length > 0);
        this._members.push(...parts);
        return this;
    }

    clear(): this {
        this._members = [];
        return this;
    }

    getConnectionTimeoutSeconds(): number {
        return this._connectionTimeoutSeconds;
    }

    setConnectionTimeoutSeconds(connectionTimeoutSeconds: number): this {
        this._connectionTimeoutSeconds = connectionTimeoutSeconds;
        return this;
    }

    getRequiredMember(): string | null {
        return this._requiredMember;
    }

    setRequiredMember(requiredMember: string): this {
        this._requiredMember = requiredMember;
        return this;
    }
}
