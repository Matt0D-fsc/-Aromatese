import { describe, it, expect, beforeEach } from 'vitest';
import { PilotMonitoringService } from '../src/services/PilotMonitoringService.js';

describe('PHASE 8: Pilot Rollout & Post-Launch Monitoring Exit Criteria Validation', () => {
  let pilotService: PilotMonitoringService;
  const PILOT_TENANT_ID = 'pilot-merchant-bd-001';

  beforeEach(() => {
    pilotService = new PilotMonitoringService();
    pilotService.initializePilotTenant(PILOT_TENANT_ID, 10);
  });

  it('EXIT CRITERION 1: Staged Traffic Ramp — Successfully ramps pilot merchant from 10% to 100% full autonomy', () => {
    const metrics = pilotService.getTenantMetrics(PILOT_TENANT_ID);
    expect(metrics).toBeDefined();
    expect(metrics?.trafficSharePercentage).toBe(10);

    // Serve 50 pilot messages
    for (let i = 0; i < 50; i++) {
      pilotService.recordMessageServed(PILOT_TENANT_ID);
    }

    // Ramp stage 1: 50%
    const ramp1 = pilotService.rampTrafficShare(PILOT_TENANT_ID, 50);
    expect(ramp1.success).toBe(true);
    expect(ramp1.currentShare).toBe(50);

    // Ramp stage 2: 100% full autonomy
    const ramp2 = pilotService.rampTrafficShare(PILOT_TENANT_ID, 100);
    expect(ramp2.success).toBe(true);
    expect(ramp2.currentShare).toBe(100);
  });

  it('EXIT CRITERION 2: Safety Gate Lockdown — Ramping is blocked if unresolved disputes or kill switch events exist', () => {
    const metrics = pilotService.getTenantMetrics(PILOT_TENANT_ID)!;
    metrics.unresolvedDisputesCount = 1; // Inject dispute

    const rampAttempt = pilotService.rampTrafficShare(PILOT_TENANT_ID, 50);
    expect(rampAttempt.success).toBe(false);
    expect(rampAttempt.reason).toContain('UNRESOLVED_DISPUTES_EXIST');
    expect(rampAttempt.currentShare).toBe(10); // Traffic share remains locked at 10%
  });
});
