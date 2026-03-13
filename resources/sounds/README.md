# RhythmDesk Sound Files

Place custom sound files (.wav, .mp3, .ogg) in this directory.

## Sound Events

The following events can have custom sounds:

| Event | Default File | Description |
|-------|-------------|-------------|
| `break_start` | chime.wav | Short/long break starting |
| `break_end` | bell.wav | Break ending, work resuming |
| `transition_start` | ding.wav | Sit-to-stand or stand-to-sit transition |
| `phase_warning` | tick.wav | Warning before phase ends |
| `session_start` | start.wav | Session/schedule started |
| `session_reset` | reset.wav | Session reset |
| `postpone` | swoosh.wav | Break postponed |
| `focus_lock_start` | lock.wav | Office Focus Lock started |
| `focus_lock_end` | unlock.wav | Office Focus Lock ended |
| `rest_block_start` | rest.wav | Custom rest block started |
| `rest_block_end` | bell.wav | Custom rest block ended |

## Adding Custom Sounds

1. Place your sound file in this directory
2. Go to Settings → Sounds
3. Select your sound file for the desired event

## Recommended Sound Specifications

- **Format:** WAV, MP3, or OGG
- **Duration:** 0.5 - 3 seconds
- **Sample Rate:** 44100 Hz
- **Bit Depth:** 16-bit

## Fallback

If a sound file is missing, the system will use a simple beep as fallback.

## Linux Audio

Sound playback uses:
- PulseAudio (`paplay`) - preferred
- ALSA (`aplay`) - fallback

Make sure one of these is available on your system.
