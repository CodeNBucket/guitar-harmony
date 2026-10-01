import { useCallback, useEffect, useRef, useState } from 'react';
import { useLang } from '../lib/i18n';
import { AudioInput } from './audio';
import { HarmonyEngine, type HarmonyEvent } from './engine';
import { loadBasicPitch } from './model';
import type { Mood } from './mood';
import { HarmonyScene } from './scene/Scene';

// the demo: the owner's own recording of the Stairway to Heaven intro
const DEMO_URL = `${import.meta.env.BASE_URL}audio/harmony-demo.m4a`;

const copy = {
  en: {
    back: 'source on github',
    title: 'play anything.',
    title2: "i'll paint the mood.",
    sub: "grab a guitar and play. it listens, feels the mood and builds a world around it: a moonlit forest, a sunny wood or the sea at sunset (or pick one, top right). a wrong note brings lightning.",
    mic: 'play live',
    micHint: 'uses your microphone',
    demo: 'hear a demo',
    file: 'use a recording',
    privacy: 'audio stays in your browser. nothing is uploaded.',
    howOpen: 'how does it work?',
    howClose: 'close',
    how: [
      { h: 'what it uses', p: 'Everything runs in your browser and the audio never leaves it. It listens with two ears. The quick one is a classic pitch tracker (the McLeod method) that names a single plucked string in about 50 milliseconds. The careful one is Basic Pitch, a small open source neural network from Spotify that can pull apart chords and ringing notes, a little later. The world itself is drawn with WebGL.' },
      { h: 'how it finds the key', p: 'It never asks you for the key. Every note you play adds to a running count, and that pattern is compared with how notes are usually spread in each of the 24 keys (12 notes, each major or minor). The chords you play and the notes in the bass get a vote too. Once one key is clearly ahead it locks in; if the song moves, it follows after a few seconds.' },
      { h: 'how it picks the world', p: 'How busy the playing is, whether it leans major or minor, and how colourful the chords are add up to a mood: melancholy brings a moonlit forest, happy a sunny one, romantic the sea at sunset. You can also pick one yourself, top right.' },
      { h: 'what counts as a wrong note', p: 'Being outside the key is not enough. Both ears have to hear the note clearly, it can’t belong to a chord you’re playing, it can’t be a passing note between two others or a note that leans into the next one, and nothing counts in the first seconds after the key is found. The rule behind all of it: a false alarm is much worse than a missed slip. Played correctly, 22 songs (20 test songs and two real recordings of the Stairway intro) didn’t get a single false alarm.' },
      { h: 'how it shows it', p: 'No text, no score; the scene is the only feedback. Every stroke lights the world for a moment, and every note has its own colour and shape: low strings a soft glow, the middle ones a ring, the high ones a spinning star. Play well and the sun grows stronger and the leaves start to move. Play a wrong note and lightning cracks across the sky, followed by a short storm.' },
    ],
    listening: 'listening…',
    mood: {
      sad: 'melancholy · a moonlit forest',
      happy: 'happy · a sunny forest',
      romantic: 'romantic · the sea at sunset',
    } as Record<Mood, string>,
    stop: 'stop',
    micError: "couldn't open the microphone",
    fileError: "couldn't read that file",
    noWebgl: 'this browser has no WebGL2, so the scene is off',
    play: 'play something',
    pick: 'scene',
    picks: { auto: 'auto', sad: 'night forest', happy: 'sunny forest', romantic: 'sea' } as Record<Pick, string>,
  },
  tr: {
    back: 'kaynak kodu (github)',
    title: 'ne istersen çal.',
    title2: 'havasını ben kurarım.',
    sub: 'gitarı al ve çal. dinler, havasını anlar ve etrafına bir dünya kurar: ay ışığında orman, güneşli orman ya da gün batımında deniz (sağ üstten kendin de seçebilirsin). yanlış notada şimşek çakar.',
    mic: 'canlı çal',
    micHint: 'mikrofonunu kullanır',
    demo: 'demo dinle',
    file: 'kayıt yükle',
    privacy: 'ses tarayıcında kalır, hiçbir yere yüklenmez.',
    howOpen: 'nasıl çalışıyor?',
    howClose: 'kapat',
    how: [
      { h: 'ne kullanıyor', p: 'Her şey tarayıcında çalışıyor, ses hiçbir yere gitmiyor. Sesi iki kulakla dinliyor. Hızlı olanı klasik bir perde takipçisi (McLeod yöntemi): tek bir teli çaldığında notayı yaklaşık 50 milisaniyede söylüyor. Dikkatli olanı Spotify’ın açık kaynak Basic Pitch modeli: akorları ve üst üste tınlayan notaları ayırabilen küçük bir yapay sinir ağı, biraz daha geriden geliyor. Sahnenin kendisi WebGL ile çiziliyor.' },
      { h: 'tonu nasıl buluyor', p: 'Tonu sana sormuyor. Çaldığın her nota bir sayaca ekleniyor ve bu dağılım, 24 tonun (12 nota, her biri majör ya da minör) tipik nota dağılımıyla karşılaştırılıyor. Çaldığın akorlar ve basta duyulan notalar da oy veriyor. Bir ton açıkça öne geçince kilitleniyor; şarkı başka tona geçerse birkaç saniye içinde o da geçiyor.' },
      { h: 'dünyayı nasıl seçiyor', p: 'Ne kadar hareketli çaldığın, majöre mi minöre mi yaslandığın ve akorların ne kadar renkli olduğu bir havaya dönüşüyor: hüzünlüye ay ışığında orman, mutluya güneşli orman, romantiğe gün batımında deniz. İstersen sağ üstten kendin de seçebilirsin.' },
      { h: 'neyi yanlış sayıyor', p: 'Tonun dışında olmak yetmiyor. İki kulağın da notayı net duyması gerekiyor; çaldığın akorun parçasıysa, iki nota arasında bir geçişse ya da bir sonrakine yaslanan bir süsse affediliyor; ton yeni bulunduysa ilk saniyelerde hiçbir şey sayılmıyor. Hepsinin arkasındaki kural şu: haksız bir uyarı, kaçan bir hatadan çok daha kötü. Doğru çalınan 22 şarkıda (20 test şarkısı ve Stairway girişinin iki gerçek kaydı) tek bir haksız uyarı çıkmadı.' },
      { h: 'nasıl gösteriyor', p: 'Ekranda yazı da puan da yok; tek geri bildirim sahne. Her vuruşta dünya bir an aydınlanıyor, her notanın kendi rengi ve şekli var: kalın teller yumuşak bir ışık, ortadakiler bir halka, inceler dönen bir yıldız. İyi çaldıkça güneş güçleniyor, yapraklar kıpırdamaya başlıyor. Yanlış notada gökyüzünde şimşek çakıyor, ardından kısa bir fırtına geçiyor.' },
    ],
    listening: 'dinliyorum…',
    mood: {
      sad: 'hüzünlü · ay ışığında orman',
      happy: 'mutlu · güneşli orman',
      romantic: 'romantik · gün batımında deniz',
    } as Record<Mood, string>,
    stop: 'durdur',
    micError: 'mikrofon açılamadı',
    fileError: 'dosya okunamadı',
    noWebgl: 'bu tarayıcıda WebGL2 yok, sahne kapalı',
    play: 'bir şey çal',
    pick: 'sahne',
    picks: { auto: 'otomatik', sad: 'gece ormanı', happy: 'güneşli orman', romantic: 'deniz' } as Record<Pick, string>,
  },
};

/** the world: chosen by the mood of the playing, or fixed by hand */
type Pick = 'auto' | Mood;
const PICKS: Pick[] = ['auto', 'sad', 'happy', 'romantic'];
const PICK_ICON: Record<Pick, string> = { auto: '✨', sad: '🌙', happy: '☀️', romantic: '🌅' };
const PICK_KEY = 'harmony-scene';

function loadPick(): Pick {
  try {
    const v = localStorage.getItem(PICK_KEY);
    return v && (PICKS as string[]).includes(v) ? (v as Pick) : 'auto';
  } catch {
    return 'auto';
  }
}

type ModelStatus = 'idle' | 'loading' | 'ready' | 'off';
type Source = 'mic' | 'demo' | 'file' | null;

export function HarmonyApp() {
  const { lang, toggle } = useLang();
  const t = copy[lang];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sceneRef = useRef<HarmonyScene | null>(null);
  const engineRef = useRef<HarmonyEngine | null>(null);
  const inputRef = useRef<AudioInput | null>(null);
  const modelPromise = useRef<Promise<void> | null>(null);
  const modelRef = useRef<Awaited<ReturnType<typeof loadBasicPitch>>>(null);
  const [source, setSource] = useState<Source>(null);
  const [model, setModel] = useState<ModelStatus>('idle');
  const [mood, setMood] = useState<Mood | null>(null);
  const [heard, setHeard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sceneOk, setSceneOk] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [pick, setPick] = useState<Pick>(loadPick);
  const pickRef = useRef(pick);
  const moodRef = useRef<Mood | null>(null);

  // scene lives for the whole page
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    try {
      const s = new HarmonyScene(c, { moodDriven: true });
      sceneRef.current = s;
      // dev only: poke the scene from the console (setMood, wrongNote...)
      if (import.meta.env.DEV) (window as unknown as { __scene: HarmonyScene }).__scene = s;
      s.start();
      if (pickRef.current !== 'auto') s.setMood(pickRef.current);
      return () => s.destroy();
    } catch {
      setSceneOk(false);
    }
  }, []);

  // engine ticks: poly model + key refresh; UI meter
  useEffect(() => {
    if (!source) return;
    const id = window.setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      void e.tick();
      sceneRef.current?.level(e.level);
    }, 130);
    return () => window.clearInterval(id);
  }, [source]);

  useEffect(
    () => () => {
      inputRef.current?.close();
    },
    [],
  );

  // no names, numbers or scores on screen: the scene is the only feedback
  const onEvent = useCallback((e: HarmonyEvent) => {
    const scene = sceneRef.current;
    const k = engineRef.current?.currentKey ?? null;
    switch (e.type) {
      case 'note':
        scene?.note(e);
        setHeard(true);
        break;
      case 'attack':
        scene?.attack(e.strength);
        break;
      case 'wrong':
        scene?.wrongNote();
        break;
      case 'mood':
        moodRef.current = e.mood;
        if (pickRef.current === 'auto') scene?.setMood(e.mood);
        setMood(e.mood);
        break;
      case 'noteoff':
        scene?.noteOff(e.id);
        break;
      case 'chord':
        scene?.chord({
          verdict: e.verdict,
          rootDegree: k ? (e.chord.root - k.tonic + 12) % 12 : null,
          strum: e.strum,
        });
        break;
      case 'key':
        scene?.setKey(e.state.key, e.state.confidence);
        break;
    }
  }, []);

  const ensureModel = useCallback(() => {
    if (!modelPromise.current) {
      setModel('loading');
      modelPromise.current = loadBasicPitch().then((m) => {
        if (!m) {
          setModel('off');
          return;
        }
        setModel('ready');
        engineRef.current?.attachModel(m);
        modelRef.current = m;
      });
    }
  }, []);

  const begin = useCallback(
    async (kind: Exclude<Source, null>, file?: File) => {
      setError(null);
      if (!inputRef.current) {
        inputRef.current = new AudioInput((x) => engineRef.current?.push(x));
        inputRef.current.onEnded = () => setSource(null);
      }
      const input = inputRef.current;
      // fresh engine per session: a new song, a new key
      const engine = new HarmonyEngine(modelRef.current);
      engine.on(onEvent);
      engineRef.current = engine;
      setMood(null);
      setHeard(false);
      sceneRef.current?.setKey(null, 0);
      moodRef.current = null;
      if (pickRef.current === 'auto') sceneRef.current?.setMood(null);
      ensureModel();
      try {
        if (kind === 'mic') await input.startMic();
        else {
          const data = file ? await file.arrayBuffer() : await (await fetch(DEMO_URL)).arrayBuffer();
          await input.startBuffer(await input.decode(data));
        }
        setSource(kind);
      } catch (err) {
        console.warn(err);
        setError(kind === 'mic' ? t.micError : t.fileError);
        setSource(null);
      }
    },
    [ensureModel, onEvent, t],
  );

  const choose = (p: Pick) => {
    setPick(p);
    pickRef.current = p;
    try {
      localStorage.setItem(PICK_KEY, p);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
    sceneRef.current?.setMood(p === 'auto' ? moodRef.current : p);
  };

  const stop = () => {
    inputRef.current?.stop();
    setSource(null);
  };

  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (f) void begin('file', f);
  };

  const running = source !== null;

  return (
    <div
      className={`hz ${running ? 'hz--running' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles(e.dataTransfer.files);
      }}
    >
      <canvas ref={canvasRef} className="hz-canvas" />
      {!sceneOk && <div className="hz-fallback">{t.noWebgl}</div>}

      <header className="hz-top">
        <a className="hz-back" href="https://github.com/CodeNBucket/guitar-harmony" target="_blank" rel="noreferrer">
          {t.back}
        </a>
        <div className="hz-key">
          {running && mood && pick === 'auto' ? (
            <span key={mood} className="hz-mood">
              {t.mood[mood]}
            </span>
          ) : running ? (
            <span className="hz-key-label">{t.listening}</span>
          ) : null}
        </div>
        <div className="hz-top-right">
          <div className="hz-pick" role="radiogroup" aria-label={t.pick}>
            {PICKS.map((p) => (
              <button
                key={p}
                role="radio"
                aria-checked={pick === p}
                className={pick === p ? 'is-on' : ''}
                title={t.picks[p]}
                onClick={() => choose(p)}
              >
                <span aria-hidden>{PICK_ICON[p]}</span>
                <span className="hz-pick-label">{t.picks[p]}</span>
              </button>
            ))}
          </div>
          {running && (
            <button className="hz-lang" onClick={stop} title={t.stop} aria-label={t.stop}>
              ■
            </button>
          )}
          <button className="hz-lang" onClick={toggle}>
            {lang === 'en' ? 'TR' : 'EN'}
          </button>
        </div>
      </header>

      {running && !heard && (
        <main className="hz-stage">
          <div className="hz-note hz-note--idle">{t.play}</div>
        </main>
      )}

      {!running && (
        <section className="hz-intro">
          <h1>
            {t.title}
            <br />
            <span>{t.title2}</span>
          </h1>
          <p>{t.sub}</p>
          <div className="hz-actions">
            <button className="hz-btn hz-btn--main" onClick={() => void begin('mic')}>
              <span>🎸 {t.mic}</span>
              <small>{t.micHint}</small>
            </button>
            <button className="hz-btn" onClick={() => void begin('demo')}>
              ▶ {t.demo}
            </button>
            <button className="hz-btn" onClick={() => fileRef.current?.click()}>
              ⤒ {t.file}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,video/*"
              hidden
              onChange={(e) => onFiles(e.target.files)}
            />
          </div>
          {error && <p className="hz-error">{error}</p>}
          <p className="hz-privacy">
            {t.privacy}{' '}
            <button className="hz-how-link" onClick={() => setShowHow(true)}>
              {t.howOpen}
            </button>
          </p>
        </section>
      )}

      {showHow && !running && (
        <div className="hz-how" role="dialog" aria-label={t.howOpen} onClick={() => setShowHow(false)}>
          <article onClick={(e) => e.stopPropagation()}>
            <h2>{t.howOpen}</h2>
            {t.how.map((x) => (
              <section key={x.h}>
                <h3>{x.h}</h3>
                <p>{x.p}</p>
              </section>
            ))}
            <button className="hz-btn hz-btn--small" onClick={() => setShowHow(false)}>
              {t.howClose}
            </button>
          </article>
        </div>
      )}
      {dragging && <div className="hz-drop">{t.file}</div>}
    </div>
  );
}
