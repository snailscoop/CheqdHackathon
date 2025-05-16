#!/usr/bin/env python3
# Vosk-based transcription script

import sys
import json
import os
import wave
from vosk import Model, KaldiRecognizer, SetLogLevel

# Set logging level to suppress non-critical messages
SetLogLevel(-1)

def transcribe_audio(audio_path, model_path=None):
    """
    Transcribe audio file using Vosk speech recognition.
    
    Args:
        audio_path: Path to audio file (wav format)
        model_path: Path to Vosk model, uses default if None
    
    Returns:
        JSON formatted transcription
    """
    # Check if file exists
    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"Audio file not found: {audio_path}"}))
        sys.exit(1)
    
    # Use default model if not specified
    if not model_path:
        model_path = "models/vosk-model-small-en-us-0.15"
    
    # Check if model exists, if not download instructions
    if not os.path.exists(model_path):
        print(json.dumps({
            "error": f"Model not found: {model_path}",
            "instructions": "Download model from https://alphacephei.com/vosk/models"
        }))
        sys.exit(1)
    
    try:
        # Load model
        model = Model(model_path)
        
        # Open audio file
        wf = wave.open(audio_path, "rb")
        
        # Check format
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getcomptype() != "NONE":
            print(json.dumps({
                "error": "Audio file must be mono WAV format at 16 bit PCM"
            }))
            sys.exit(1)
        
        # Create recognizer
        rec = KaldiRecognizer(model, wf.getframerate())
        rec.SetWords(True)
        rec.SetPartialWords(True)
        
        # Process audio chunks
        results = []
        chunk_size = wf.getframerate() * 5  # 5 second chunks
        
        while True:
            data = wf.readframes(chunk_size)
            if len(data) == 0:
                break
            
            if rec.AcceptWaveform(data):
                part_result = json.loads(rec.Result())
                results.append(part_result)
        
        # Get final result
        part_result = json.loads(rec.FinalResult())
        results.append(part_result)
        
        # Process results into a structured transcript
        transcript = {
            "segments": [],
            "full_text": ""
        }
        
        for i, res in enumerate(results):
            if "result" in res:
                segment = {
                    "id": i,
                    "start": res["result"][0]["start"] if res["result"] else i*5,
                    "end": res["result"][-1]["end"] if res["result"] else (i+1)*5,
                    "text": res["text"],
                    "words": res["result"]
                }
                transcript["segments"].append(segment)
                transcript["full_text"] += res["text"] + " "
        
        transcript["full_text"] = transcript["full_text"].strip()
        
        # Output JSON result
        print(json.dumps(transcript, ensure_ascii=False, indent=2))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python transcribe.py <audio_file> [model_path]"}))
        sys.exit(1)
    
    audio_path = sys.argv[1]
    model_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    transcribe_audio(audio_path, model_path) 