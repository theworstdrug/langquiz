import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { loadYouTubeApi, type YTPlayer } from '../lib/youtube';

/** Common controls for an <audio>/<video> element or an embedded YouTube player. */
export interface MediaHandle {
  seek(t: number): void;
  play(): void;
  pause(): void;
  isPaused(): boolean;
}

interface Props {
  src?: string;
  youtubeId?: string;
  synced: boolean;
  follow: boolean;
  onFollowChange: (v: boolean) => void;
  onTime: (t: number) => void;
  onPause: () => void;
}

const RATES = [0.5, 0.75, 0.9, 1, 1.25, 1.5];

export default forwardRef<MediaHandle, Props>(function MediaPlayer({ src, youtubeId, synced, follow, onFollowChange, onTime, onPause }, ref) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const ytHost = useRef<HTMLDivElement>(null);
  const yt = useRef<YTPlayer | null>(null);
  const [ytError, setYtError] = useState('');
  const [showVideo, setShowVideo] = useState(true);
  const cb = useRef({ onTime, onPause });
  cb.current = { onTime, onPause };

  useImperativeHandle(ref, () => ({
    seek: (t) => (yt.current ? yt.current.seekTo(t, true) : audioRef.current && (audioRef.current.currentTime = t)),
    play: () => (yt.current ? yt.current.playVideo() : audioRef.current?.play()),
    pause: () => (yt.current ? yt.current.pauseVideo() : audioRef.current?.pause()),
    isPaused: () => (yt.current ? yt.current.getPlayerState() !== window.YT?.PlayerState.PLAYING : audioRef.current?.paused ?? true),
  }));

  useEffect(() => {
    if (!youtubeId || !ytHost.current) return;
    let timer: number | undefined;
    let cancelled = false;
    const el = document.createElement('div');
    ytHost.current.appendChild(el);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        yt.current = new YT.Player(el, {
          videoId: youtubeId,
          width: '100%',
          height: '100%',
          playerVars: { rel: 0, playsinline: 1, cc_load_policy: 0 },
          events: {
            onStateChange: (e: { data: number }) => {
              if (e.data === 2 || e.data === 0) cb.current.onPause();
            },
          },
        });
        // The IFrame API has no timeupdate event; poll while playing.
        timer = window.setInterval(() => {
          const p = yt.current;
          if (p?.getPlayerState && p.getPlayerState() === YT.PlayerState.PLAYING) cb.current.onTime(p.getCurrentTime());
        }, 250);
      })
      .catch((e) => setYtError(e.message));
    return () => {
      cancelled = true;
      clearInterval(timer);
      yt.current?.destroy();
      yt.current = null;
      el.remove();
    };
  }, [youtubeId]);

  const setRate = (r: number) => {
    if (yt.current) yt.current.setPlaybackRate(r);
    else if (audioRef.current) audioRef.current.playbackRate = r;
  };
  const back5 = () => {
    if (yt.current) yt.current.seekTo(Math.max(0, yt.current.getCurrentTime() - 5), true);
    else if (audioRef.current) audioRef.current.currentTime -= 5;
  };

  return (
    <div className={`media ${youtubeId ? 'is-video' : ''}`}>
      {youtubeId && (
        <div className={`yt-frame ${showVideo ? '' : 'collapsed'}`} ref={ytHost}>
          {ytError && <p className="error">{ytError}</p>}
        </div>
      )}
      <div className="audio-bar">
        {!youtubeId && src && (
          <audio
            ref={audioRef}
            src={src}
            controls
            onTimeUpdate={(e) => cb.current.onTime(e.currentTarget.currentTime)}
            onPause={() => cb.current.onPause()}
          />
        )}
        {youtubeId && (
          <button onClick={() => setShowVideo(!showVideo)} title={showVideo ? 'Hide video (audio keeps playing)' : 'Show video'}>
            {showVideo ? '▾ Hide video' : '▸ Show video'}
          </button>
        )}
        <select aria-label="Playback speed" defaultValue="1" onChange={(e) => setRate(Number(e.target.value))}>
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
        <button className="icon" title="Back 5s" onClick={back5}>
          ⏪
        </button>
        {synced && (
          <label className="small row">
            <input type="checkbox" checked={follow} onChange={(e) => onFollowChange(e.target.checked)} /> follow
          </label>
        )}
      </div>
    </div>
  );
});
