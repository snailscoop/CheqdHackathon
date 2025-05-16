#!/usr/bin/env python3
# transcribe_audio.py - Audio transcription script using Vosk

import argparse
import json
import os
import sys
import wave
import vosk
import time

def transcribe_audio(audio_path, model_path, chunk_size=4000):
    """
    Transcribe audio file using Vosk
    """
    result = {
        "success": False,
        "error": None,
        "results": [],
        "full_text": ""
    }
    
    try:
        # Check if model exists
        if not os.path.exists(model_path):
            result["error"] = f"Model not found: {model_path}"
            return result
        
        # Check if audio file exists
        if not os.path.exists(audio_path):
            result["error"] = f"Audio file not found: {audio_path}"
            return result
        
        # Load Vosk model
        model = vosk.Model(model_path)
        
        # Open audio file
        wf = wave.open(audio_path, "rb")
        
        # Check audio format
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getcomptype() != "NONE":
            result["error"] = "Audio file must be WAV format mono PCM"
            return result
        
        # Create recognizer
        recognizer = vosk.KaldiRecognizer(model, wf.getframerate())
        recognizer.SetWords(True)
        
        # Process audio in chunks
        full_text = []
        
        while True:
            data = wf.readframes(chunk_size)
            if len(data) == 0:
                break
            
            if recognizer.AcceptWaveform(data):
                part_result = json.loads(recognizer.Result())
                if part_result.get("text", "").strip():
                    part_result["time"] = wf.tell() / wf.getframerate()
                    result["results"].append(part_result)
                    full_text.append(part_result.get("text", ""))
        
        # Get final result
        part_result = json.loads(recognizer.FinalResult())
        if part_result.get("text", "").strip():
            part_result["time"] = wf.tell() / wf.getframerate()
            result["results"].append(part_result)
            full_text.append(part_result.get("text", ""))
        
        result["full_text"] = " ".join(full_text)
        result["success"] = True
        
    except Exception as e:
        result["error"] = str(e)
    
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Transcribe audio using Vosk")
    parser.add_argument("--audio", required=True, help="Path to audio file")
    parser.add_argument("--model", required=True, help="Path to Vosk model")
    parser.add_argument("--chunk-size", type=int, default=4000, help="Audio chunk size")
    
    args = parser.parse_args()
    
    result = transcribe_audio(args.audio, args.model, args.chunk_size)
    print(json.dumps(result))
