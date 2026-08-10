export interface PilotMetrics {
  tenantId: string;
  trafficSharePercentage: number;
  totalMessagesServed: number;
  unresolvedDisputesCount: number;
  killSwitchTriggersCount: number;
  humanEscalationRate: number;
  validatorCatchRate: number;
  averageResponseTimeMs: number;
}

export class PilotMonitoringService {
  private tenantMetrics: Map<string, PilotMetrics> = new Map();

  public initializePilotTenant(tenantId: string, initialTrafficShare: number = 10): PilotMetrics {
    const metrics: PilotMetrics = {
      tenantId,
      trafficSharePercentage: initialTrafficShare,
      totalMessagesServed: 0,
      unresolvedDisputesCount: 0,
      killSwitchTriggersCount: 0,
      humanEscalationRate: 0.02, // 2% normal escalation
      validatorCatchRate: 1.0,  // 100% anti-hallucination catch rate
      averageResponseTimeMs: 420,
    };
    this.tenantMetrics.set(tenantId, metrics);
    return metrics;
  }

  /**
   * Increase traffic share in staged ramps (e.g. 10% -> 25% -> 50% -> 100%) if exit gates pass.
   */
  public rampTrafficShare(tenantId: string, targetShare: number): { success: boolean; currentShare: number; reason?: string } {
    const metrics = this.tenantMetrics.get(tenantId);
    if (!metrics) return { success: false, currentShare: 0, reason: 'TENANT_NOT_FOUND' };

    if (metrics.unresolvedDisputesCount > 0) {
      return {
        success: false,
        currentShare: metrics.trafficSharePercentage,
        reason: 'UNRESOLVED_DISPUTES_EXIST: Cannot ramp traffic until all disputes are resolved.',
      };
    }

    if (metrics.killSwitchTriggersCount > 0) {
      return {
        success: false,
        currentShare: metrics.trafficSharePercentage,
        reason: 'KILL_SWITCH_WAS_TRIGGERED: Cannot ramp traffic until safety audit passes.',
      };
    }

    metrics.trafficSharePercentage = Math.min(100, Math.max(0, targetShare));
    return { success: true, currentShare: metrics.trafficSharePercentage };
  }

  public recordMessageServed(tenantId: string): void {
    const metrics = this.tenantMetrics.get(tenantId);
    if (metrics) {
      metrics.totalMessagesServed++;
    }
  }

  public getTenantMetrics(tenantId: string): PilotMetrics | undefined {
    return this.tenantMetrics.get(tenantId);
  }
}
