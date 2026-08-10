import { ILLMProvider } from '../interfaces/ILLMProvider.js';

export interface VoiceProcessingResult {
  transcript: string;
  confidence: number;
  isUnclear: boolean;
  suggestedAction: 'process' | 'escalate_to_human';
}

export class VoiceProcessingService {
  private llmProvider: ILLMProvider;
  private confidenceThreshold: number;

  constructor(llmProvider: ILLMProvider, confidenceThreshold: number = 0.6) {
    this.llmProvider = llmProvider;
    this.confidenceThreshold = confidenceThreshold;
  }

  /**
   * Process raw spoken voice note buffer (OGG/MP3/M4A/WAV from WhatsApp/FB Messenger).
   */
  public async processVoiceNote(
    audioBuffer: Buffer,
    mimeType: string = 'audio/ogg'
  ): Promise<VoiceProcessingResult> {
    try {
      const prompt = `Transcribe this spoken audio clip accurately into text (Bengali script or Banglish). 
Evaluate the audio quality and background noise. 
If the audio is completely unintelligible or muffled by heavy street/market noise, include "[UNCLEAR_AUDIO]" in your output.`;

      const audioRes = await this.llmProvider.processAudio(audioBuffer, mimeType, prompt);
      const text = audioRes.transcript || '';

      const isUnclear = text.includes('[UNCLEAR_AUDIO]') || text.trim().length < 2;
      const confidence = isUnclear ? 0.3 : (audioRes.confidence ?? 0.9);

      return {
        transcript: text.replace('[UNCLEAR_AUDIO]', '').trim(),
        confidence,
        isUnclear,
        suggestedAction: confidence < this.confidenceThreshold ? 'escalate_to_human' : 'process',
      };
    } catch (err) {
      return {
        transcript: '',
        confidence: 0,
        isUnclear: true,
        suggestedAction: 'escalate_to_human',
      };
    }
  }
}
