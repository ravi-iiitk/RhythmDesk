#!/usr/bin/env python3
"""
Generate distinct notification WAV sounds for RhythmDesk.
Each event type gets a unique tone/pattern so users can distinguish them by ear.
"""

import wave
import struct
import math
import os

SAMPLE_RATE = 44100
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'resources', 'sounds')


def generate_tone(freq, duration_ms, volume=0.5, sample_rate=SAMPLE_RATE):
    """Generate a pure sine tone."""
    n_samples = int(sample_rate * duration_ms / 1000)
    samples = []
    for i in range(n_samples):
        t = i / sample_rate
        # Apply fade in/out (10ms) to avoid clicks
        fade_samples = int(sample_rate * 0.01)
        envelope = 1.0
        if i < fade_samples:
            envelope = i / fade_samples
        elif i > n_samples - fade_samples:
            envelope = (n_samples - i) / fade_samples
        value = volume * envelope * math.sin(2 * math.pi * freq * t)
        samples.append(value)
    return samples


def generate_bell(freq, duration_ms, volume=0.7, decay=3.0, sample_rate=SAMPLE_RATE):
    """Generate a bell-like tone with harmonics and exponential decay."""
    n_samples = int(sample_rate * duration_ms / 1000)
    samples = []
    # Bell harmonics: fundamental, 2x, 3x, 5x with decreasing amplitude
    harmonics = [
        (1.0, 1.0),
        (2.0, 0.6),
        (3.0, 0.4),
        (4.17, 0.25),
        (5.43, 0.15),
    ]
    for i in range(n_samples):
        t = i / sample_rate
        envelope = math.exp(-decay * t / (duration_ms / 1000))
        # Fade in first 5ms
        fade_in = min(1.0, i / (sample_rate * 0.005))
        value = 0.0
        for harm_mult, harm_amp in harmonics:
            value += harm_amp * math.sin(2 * math.pi * freq * harm_mult * t)
        # Normalize harmonics sum
        value = value / sum(h[1] for h in harmonics)
        samples.append(volume * fade_in * envelope * value)
    return samples


def generate_chime(freqs, note_duration_ms=200, gap_ms=50, volume=0.5):
    """Generate a sequence of tones (chime pattern)."""
    samples = []
    gap_samples = int(SAMPLE_RATE * gap_ms / 1000)
    for freq in freqs:
        samples.extend(generate_tone(freq, note_duration_ms, volume))
        samples.extend([0.0] * gap_samples)
    return samples


def generate_double_bell(freq, duration_ms=600, volume=0.8, decay=4.0):
    """Generate two bell strikes for a bold, attention-grabbing sound."""
    bell1 = generate_bell(freq, duration_ms, volume, decay)
    gap = [0.0] * int(SAMPLE_RATE * 0.15)  # 150ms gap
    bell2 = generate_bell(freq * 1.005, duration_ms, volume * 0.9, decay)  # Slightly detuned for richness
    return bell1 + gap + bell2


def generate_swoosh(duration_ms=300, volume=0.4):
    """Generate a swoosh/whoosh sound using filtered noise with frequency sweep."""
    n_samples = int(SAMPLE_RATE * duration_ms / 1000)
    samples = []
    for i in range(n_samples):
        t = i / n_samples
        # Frequency sweep from low to high
        freq = 200 + 2000 * t
        phase = 2 * math.pi * freq * i / SAMPLE_RATE
        # Mix sine with some noise-like harmonics
        value = math.sin(phase) * 0.6
        value += math.sin(phase * 2.37) * 0.2
        value += math.sin(phase * 3.71) * 0.1
        # Bell curve envelope (peaks in middle)
        envelope = math.exp(-8 * (t - 0.4) ** 2)
        samples.append(volume * envelope * value)
    return samples


def generate_click(duration_ms=80, volume=0.5):
    """Generate a short click/tick sound."""
    n_samples = int(SAMPLE_RATE * duration_ms / 1000)
    samples = []
    for i in range(n_samples):
        t = i / SAMPLE_RATE
        envelope = math.exp(-30 * t)
        value = math.sin(2 * math.pi * 1000 * t) + 0.5 * math.sin(2 * math.pi * 2500 * t)
        samples.append(volume * envelope * value / 1.5)
    return samples


def write_wav(filename, samples, sample_rate=SAMPLE_RATE):
    """Write samples to a WAV file."""
    filepath = os.path.join(OUTPUT_DIR, filename)
    # Clamp samples to [-1, 1]
    samples = [max(-1.0, min(1.0, s)) for s in samples]
    # Convert to 16-bit PCM
    pcm_data = b''.join(struct.pack('<h', int(s * 32767)) for s in samples)
    
    with wave.open(filepath, 'w') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_data)
    
    print(f"  Created: {filename} ({len(samples) / sample_rate:.2f}s)")


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f"Generating sounds in: {OUTPUT_DIR}\n")

    # 1. chime.wav - Break starting: gentle ascending 3-note chime (C5-E5-G5)
    print("break_start -> chime.wav (gentle ascending chime)")
    samples = generate_chime([523, 659, 784], note_duration_ms=180, gap_ms=60, volume=0.5)
    write_wav('chime.wav', samples)

    # 2. bell.wav - Break ending: BOLD double bell strike (attention-grabbing!)
    #    Uses a rich bell at A4 (440Hz) struck twice
    print("break_end -> bell.wav (bold double bell strike)")
    samples = generate_double_bell(440, duration_ms=800, volume=0.85, decay=2.5)
    write_wav('bell.wav', samples)

    # 3. ding.wav - Transition starting: single bright ding (high pitch)
    print("transition_start -> ding.wav (bright single ding)")
    samples = generate_bell(880, duration_ms=500, volume=0.55, decay=4.0)
    write_wav('ding.wav', samples)

    # 4. tick.wav - Phase warning: short click/tick
    print("phase_warning -> tick.wav (short click)")
    samples = generate_click(duration_ms=100, volume=0.4)
    write_wav('tick.wav', samples)

    # 5. start.wav - Session started: ascending major chord arpeggio (C4-E4-G4-C5)
    print("session_start -> start.wav (ascending major arpeggio)")
    samples = generate_chime([262, 330, 392, 523], note_duration_ms=150, gap_ms=40, volume=0.5)
    write_wav('start.wav', samples)

    # 6. reset.wav - Session reset: descending 2-note (G4-C4)
    print("session_reset -> reset.wav (descending two-note)")
    samples = generate_chime([392, 262], note_duration_ms=200, gap_ms=80, volume=0.45)
    write_wav('reset.wav', samples)

    # 7. swoosh.wav - Break postponed: whoosh/sweep sound
    print("postpone -> swoosh.wav (whoosh sweep)")
    samples = generate_swoosh(duration_ms=350, volume=0.45)
    write_wav('swoosh.wav', samples)

    # 8. lock.wav - Focus lock started: two firm ascending tones (E4-A4)
    print("focus_lock_start -> lock.wav (firm ascending pair)")
    samples = generate_chime([330, 440], note_duration_ms=120, gap_ms=30, volume=0.55)
    write_wav('lock.wav', samples)

    # 9. unlock.wav - Focus lock ended: two descending tones (A4-E4)
    print("focus_lock_end -> unlock.wav (descending pair)")
    samples = generate_chime([440, 330], note_duration_ms=120, gap_ms=30, volume=0.5)
    write_wav('unlock.wav', samples)

    # 10. rest.wav - Rest block started: warm low bell (C4)
    print("rest_block_start -> rest.wav (warm low bell)")
    samples = generate_bell(262, duration_ms=700, volume=0.55, decay=2.5)
    write_wav('rest.wav', samples)

    print("\n✓ All 10 sound files generated successfully!")
    print(f"  Directory: {OUTPUT_DIR}")


if __name__ == '__main__':
    main()
