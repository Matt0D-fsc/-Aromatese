export interface PiiFieldPolicy {
  field: string;
  dataType: string;
  destination: string;
  retentionPolicy: string;
  encryptionMethod: string;
}

export class PiiComplianceAndMigration {
  public static getPiiDisclosureMatrix(): PiiFieldPolicy[] {
    return [
      {
        field: 'Customer Phone Number',
        dataType: 'PII / Contact',
        destination: 'Supabase PostgreSQL (customers table)',
        retentionPolicy: '365 days (or merchant deletion request)',
        encryptionMethod: 'PostgreSQL TLS in-transit + AES-256 at rest',
      },
      {
        field: 'Delivery Address',
        dataType: 'PII / Location',
        destination: 'Supabase PostgreSQL & Pathao/Steadfast Courier APIs',
        retentionPolicy: 'Order fulfillment lifecycle',
        encryptionMethod: 'HTTPS REST TLS 1.3',
      },
      {
        field: 'Voice Note Audio Streams',
        dataType: 'Biometric / Audio Media',
        destination: 'Google Gemini Multimodal API (In-memory buffer only)',
        retentionPolicy: 'Zero persistent storage on AI API servers',
        encryptionMethod: 'gRPC / HTTPS TLS 1.3',
      },
      {
        field: 'Customer Product Photos',
        dataType: 'Image Media',
        destination: 'Supabase Storage & pgvector Embeddings',
        retentionPolicy: 'Merchant storage quota dependent',
        encryptionMethod: 'Supabase Storage RLS + Signed URLs',
      },
    ];
  }

  public static getMigrationRunbookSteps(): Array<{ step: number; action: string; verification: string }> {
    return [
      {
        step: 1,
        action: 'Provision GCP Vertex AI Enterprise Project with dedicated RPM/TPM quotas.',
        verification: 'Execute ILLMProvider health check against Vertex AI endpoint.',
      },
      {
        step: 2,
        action: 'Upgrade Supabase Project from Free Tier to Supabase Pro / AWS Aurora Cluster.',
        verification: 'Verify database connection pooler and run 001_phase0_foundations.sql schema check.',
      },
      {
        step: 3,
        action: 'Configure Redis Enterprise Cluster for IMessageQueue and BullMQ worker pool.',
        verification: 'Run 1,000 message burst test to verify sub-10ms queue latency.',
      },
      {
        step: 4,
        action: 'Execute full test suite (Phases 0 through 8) on paid production environment.',
        verification: '100% passing test suite across all exit criteria.',
      },
    ];
  }
}
