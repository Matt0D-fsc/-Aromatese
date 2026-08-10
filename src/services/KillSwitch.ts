export interface KillSwitchStatus {
  isAllowed: boolean;
  reason?: string;
}

export interface TenantKillSwitchProvider {
  getTenantAiEnabled(tenantId: string): Promise<boolean>;
  getConversationMutedStatus(tenantId: string, conversationId: string): Promise<boolean>;
}

export class KillSwitch {
  private globalAiDisabled: boolean = false;
  private tenantProvider?: TenantKillSwitchProvider;

  constructor(tenantProvider?: TenantKillSwitchProvider) {
    this.tenantProvider = tenantProvider;
  }

  /**
   * Set global kill switch status (platform-wide override).
   */
  public setGlobalAiDisabled(disabled: boolean): void {
    this.globalAiDisabled = disabled;
  }

  public isGlobalAiDisabled(): boolean {
    return this.globalAiDisabled;
  }

  /**
   * Check if AI reply generation is allowed for a specific tenant and conversation.
   * Execution must fail fast if any kill switch is tripped.
   */
  public async canGenerateAiReply(tenantId: string, conversationId?: string): Promise<KillSwitchStatus> {
    if (this.globalAiDisabled) {
      return {
        isAllowed: false,
        reason: 'GLOBAL_KILL_SWITCH_ACTIVE',
      };
    }

    if (this.tenantProvider) {
      const tenantEnabled = await this.tenantProvider.getTenantAiEnabled(tenantId);
      if (!tenantEnabled) {
        return {
          isAllowed: false,
          reason: 'TENANT_KILL_SWITCH_ACTIVE',
        };
      }

      if (conversationId) {
        const isMuted = await this.tenantProvider.getConversationMutedStatus(tenantId, conversationId);
        if (isMuted) {
          return {
            isAllowed: false,
            reason: 'CONVERSATION_HUMAN_TAKEOVER_MUTED',
          };
        }
      }
    }

    return { isAllowed: true };
  }
}
