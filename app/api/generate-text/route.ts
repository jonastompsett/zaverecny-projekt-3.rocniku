import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: Request) {
  try {
    const { audioUrl, language = 'cs' } = await req.json();
    if (!audioUrl) return NextResponse.json({ error: 'audioUrl is required' }, { status: 400 });

    const audioRes = await fetch(audioUrl);
    const blob = await audioRes.blob();
    const file = new File([blob], 'input.mp3', { type: 'audio/mpeg' });

    const transcription: any = await groq.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3',
      language: language === 'cs' ? 'cs' : 'en',
      temperature: 0,
      response_format: 'verbose_json',
      timestamp_granularities: ['word'],
    });

    const segments = (transcription.words || []).map((w: any) => ({
      text: w.word,
      start: Number(w.start.toFixed(2)),
      end: Number(w.end.toFixed(2)),
    }));

    return NextResponse.json({
      text: transcription.text,
      segments,
      duration: transcription.duration,
    });
  } catch (error: any) {
    console.error('Groq Whisper Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}