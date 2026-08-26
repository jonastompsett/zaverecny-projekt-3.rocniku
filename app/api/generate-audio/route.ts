import { NextResponse } from 'next/server';
import { UniversalEdgeTTS } from 'edge-tts-universal';
import Groq from 'groq-sdk';
import fs from 'fs';
import path from 'path';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: Request) {
  try {
    const { text, language = 'cs', chapterIndex = 1 } = await req.json();
    if (!text) return NextResponse.json({ error: 'Text is required' }, { status: 400 });

    const voice = language === 'cs' ? 'cs-CZ-VlastaNeural' : 'en-US-JennyNeural';

    // 1. Syntéza řeči
    const tts = new UniversalEdgeTTS(text, voice);
    const result = await tts.synthesize();
    const arrayBuffer = await result.audio.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2. Uložení na disk do public/audio_cache/ (řeší 1MB limit Firestore)
    const cacheDir = path.join(process.cwd(), 'public', 'audio_cache');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const fileName = `audio_${Date.now()}_ch${chapterIndex}.mp3`;
    const filePath = path.join(cacheDir, fileName);
    fs.writeFileSync(filePath, buffer);
    const publicAudioUrl = `/audio_cache/${fileName}`;

    // 3. Zarovnání slov přes Groq Whisper
    let segments: { text: string; start: number; end: number }[] = [];
    try {
      const file = new File([buffer], 'tts_audio.mp3', { type: 'audio/mpeg' });
      const transcription: any = await groq.audio.transcriptions.create({
        file,
        model: 'whisper-large-v3',
        language: language === 'cs' ? 'cs' : 'en',
        response_format: 'verbose_json',
        timestamp_granularities: ['word'],
      });

      if (transcription.words && transcription.words.length > 0) {
        segments = transcription.words.map((w: any) => ({
          text: w.word,
          start: Number(w.start.toFixed(2)),
          end: Number(w.end.toFixed(2)),
        }));
      }
    } catch (whisperErr: any) {
      console.warn('Whisper alignment fallback:', whisperErr.message);
    }

    if (segments.length === 0) {
      const words = text.trim().split(/\s+/).filter(Boolean);
      const totalDuration = Math.max(1, buffer.length / 16000);
      const step = totalDuration / words.length;
      segments = words.map((w: string, i: number) => ({
        text: w,
        start: Number((i * step).toFixed(2)),
        end: Number(((i + 1) * step).toFixed(2)),
      }));
    }

    return NextResponse.json({
      audioUrl: publicAudioUrl,
      segments,
    });
  } catch (error: any) {
    console.error('TTS Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}