
/* Pre-mixed stereo files, played directly even when Web Audio is unavailable. */
(() => {
  const bank = JSON.parse(document.getElementById('knight-fx-clips').textContent);
  const beds = new Set(['approach','release','brake','impact','sprint']);
  function lane(name) {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.dataset.knightFxLane = name;
    return {audio, ticket:null, owner:null, cue:''};
  }
  const detailCues = new Set(["tally", "medal1", "medal2", "medal3", "medal4", "tab", "hotspot", "pin", "card", "send", "link", "rank", "settle", "progress"]);
  const body = lane('motion'), hit = lane('signal'), ui = lane('power'), detail = lane('detail');
  const all = [body, hit, ui, detail];
  let ducked = false;
  function reset(channel) {
    channel.ticket = null;
    channel.owner = null;
    channel.cue = '';
    channel.audio.onended = channel.audio.onerror = null;
    channel.audio.pause();
  }
  function duck(on) {
    ducked = on;
    for (const channel of all) {
      // The encoded levels are already balanced. Retain the physical transient under dialogue.
      channel.audio.volume = on ? (channel === body ? .76 : .84) : 1;
    }
  }
  function prime(silence) {
    for (const channel of all) {
      if (channel.ticket) continue;
      channel.audio.src = silence;
      channel.audio.play().catch(() => {});
    }
  }
  function play(cue, owner) {
    if (!bank[cue] || document.hidden) return Promise.resolve(false);
    const channel = cue === 'soundOn' ? ui : beds.has(cue) ? body : detailCues.has(cue) ? detail : hit;
    reset(channel);
    const ticket = {};
    channel.ticket = ticket;
    channel.owner = owner;
    channel.cue = cue;
    const audio = channel.audio;
    audio.dataset.knightFx = cue;
    audio.volume = ducked ? (channel === body ? .76 : .84) : 1;
    audio.src = bank[cue].src;
    function release() {
      if (channel.ticket !== ticket) return;
      channel.ticket = channel.owner = null;
      channel.cue = '';
    }
    audio.onended = audio.onerror = release;
    return audio.play().then(() => true, err => {
      if (channel.ticket !== ticket) return false;
      release();
      if (err.name === 'NotAllowedError') window.dispatchEvent(new Event('knight:blocked'));
      return false;
    });
  }
  function stopOwner(owner) {
    for (const channel of all) if (channel.owner === owner) reset(channel);
  }
  function stopAll() {
    for (const channel of all) if (channel.ticket) reset(channel);
  }
  const warming = new Set();
  function warm(cues) {
    for (const cue of cues) {
      const clip = bank[cue];
      if (!clip || warming.has(cue)) continue;
      warming.add(cue);
      fetch(clip.src).then(response => {
        if (!response.ok) throw new Error(String(response.status));
        return response.blob();
      }).then(blob => { clip.src = URL.createObjectURL(blob); })
        .catch(() => { warming.delete(cue); });
    }
  }
  window.KnightFoley = {prime,play,duck,stopOwner,stopAll,warm};
})();

/* Sound is on for a first-time viewer. An explicit mute survives reloads. */
(() => {
  const fx = window.KnightFoley;
  const audio = new Audio();
  audio.preload = 'auto';
  const silence = 'data:audio/wav;base64,UklGRgQCAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YeABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const clips = JSON.parse(document.getElementById('knight-voice-clips').textContent);
  const toggle = document.getElementById('knight-sound');
  const replay = document.getElementById('knight-replay');
  const note = document.getElementById('knight-sound-note');
  const startLabel = document.getElementById('knight-start-label');
  const gate = document.createElement('button');
  gate.type = 'button';
  gate.className = 'knight-audio-gate';
  gate.id = 'knight-audio-gate';
  const prefKey = 'knight-roadshow-sound';
  const manualOwner = Symbol('manual'), systemOwner = Symbol('system'), interfaceOwner = Symbol('interface');
  const dispatch = name => window.dispatchEvent(new Event(name));
  let preferred = true;
  try { preferred = localStorage.getItem(prefKey) !== 'off'; } catch (_) {}
  let ready = false, primedByGesture = false, blocked = false, confirmOnLanding = false;
  let active = null, proxyDepth = 0, noteTimer = 0;
  const audible = () => preferred && ready && !document.hidden;
  const isEnglish = () => document.documentElement.lang === 'en';
  function render() {
    const en = isEnglish();
    const label = preferred ? (en ? 'Mute all sound' : '关闭所有声音') : (en ? 'Enable voice and sound effects' : '开启语音和音效');
    toggle.setAttribute('aria-pressed', String(preferred));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    toggle.querySelector('span').textContent = preferred ? (en ? 'Sound on' : '声音已开') : (en ? 'Sound off' : '开启声音');
    replay.setAttribute('aria-label', en ? 'Replay this scene' : '重播当前场景');
    replay.title = replay.getAttribute('aria-label');
    startLabel.textContent = preferred ? (en ? 'Hear a riding alert' : '听听骑士的提醒') : (en ? 'View alerts without sound' : '静音查看骑行预警');
    const mast = document.querySelector('[data-page]:not([hidden]) .module-mast');
    if (preferred && blocked && mast) {
      gate.textContent = en ? 'Enable sound' : '开启声音';
      if (gate.parentNode !== mast) mast.appendChild(gate);
    } else gate.remove();
  }
  function clearNote() { clearTimeout(noteTimer); note.textContent = ''; }
  function explainMute() {
    clearNote();
    note.textContent = isEnglish() ? 'Turn on sound to listen.' : '点击「开启声音」即可试听。';
    noteTimer = setTimeout(clearNote, 2600);
  }
  function finish(job, interrupt) {
    if (!job || job !== active) return;
    active = null;
    clearTimeout(job.timeout);
    audio.onended = audio.onerror = null;
    if (interrupt) audio.pause();
    fx.duck(false);
    job.resolve();
    if (job.onEnd) job.onEnd();
  }
  function stopOwner(owner) {
    fx.stopOwner(owner);
    if (active && active.owner === owner) finish(active, true);
  }
  function quiet() {
    finish(active, true);
    fx.stopAll();
    dispatch('knight:quiet-media');
  }
  function primeMedia() {
    if (!preferred || document.hidden || primedByGesture) return;
    primedByGesture = ready = true;
    blocked = false;
    fx.prime(silence);
    if (!active) {
      audio.src = silence;
      audio.play().catch(() => {});
    }
    render();
  }
  function requireGesture() {
    if (!preferred || document.hidden) return;
    ready = primedByGesture = false;
    blocked = true;
    render();
  }
  function setPreference(on, persist) {
    preferred = on;
    if (persist) {
      try { localStorage.setItem(prefKey, on ? 'on' : 'off'); } catch (_) {}
    }
    if (!on) {
      ready = primedByGesture = blocked = confirmOnLanding = false;
      quiet();
    }
    clearNote();
    render();
  }
  function play(text, owner, onEnd) {
    const clip = clips[text];
    if (!audible() || !clip || (owner !== manualOwner && active?.owner === manualOwner)) {
      if (onEnd) onEnd();
      return null;
    }
    finish(active, true);
    let resolve;
    const done = new Promise(r => { resolve = r; });
    const job = {owner, resolve, onEnd, timeout:0};
    active = job;
    fx.duck(true);
    audio.src = clip.src;
    audio.onended = () => finish(job, false);
    audio.onerror = () => finish(job, true);
    job.timeout = setTimeout(() => finish(job, true), clip.ms + 4500);
    audio.play().catch(error => {
      if (active !== job) return;
      if (error.name === 'NotAllowedError') requireGesture();
      finish(job, true);
    });
    return {done, ms:clip.ms};
  }
  window.KnightVoice = {
    get audible() { return audible(); },
    scene: (text, owner) => play(text, owner),
    effect(cue, owner = manualOwner) {
      if (audible() && !proxyDepth) fx.play(cue, owner);
    },
    stopScene: stopOwner,
    stopManual: () => { if (!proxyDepth) stopOwner(manualOwner); },
    proxyClick(button) {
      proxyDepth++;
      try { button.click(); } finally { proxyDepth--; }
    },
    manual(text, {onEnd,explicit} = {}) {
      if (proxyDepth || !audible() || !clips[text]) {
        if (explicit && !preferred && !proxyDepth) explainMute();
        if (onEnd) onEnd();
        return false;
      }
      dispatch('knight:manual');
      return Boolean(play(text, manualOwner, onEnd));
    }
  };
  function confirmSound() { if (audible()) fx.play('soundOn',systemOwner); }
  function restart() { dispatch('knight:replay'); }
  toggle.addEventListener('click', () => {
    setPreference(!preferred, true);
    if (preferred) { primeMedia(); confirmSound(); restart(); }
  });
  gate.addEventListener('click', () => { primeMedia(); confirmSound(); restart(); });
  replay.addEventListener('click', restart);
  function gesture(event) {
    if (!event.isTrusted || event.target.closest('#knight-sound,#knight-audio-gate')) return;
    const link = event.target.closest('a[href^="#/"]');
    const newPage = link && link.hash !== location.hash;
    if (newPage) quiet();
    if (!preferred) return;
    const wasReady = ready;
    primeMedia();
    if (wasReady || !ready) return;
    if (newPage) confirmOnLanding = true;
    else {
      confirmSound();
      if (!event.target.closest('button,a,select,input,textarea')) restart();
    }
  }
  document.addEventListener('click', gesture, true);

  // Observe deliberate selections at capture time, before a panel replaces its controls.
  const selectionSounds = [
    ['.feature-tabs button,button[data-look],button[data-lang],a[data-scroll]', 'tab'],
    ['[data-place],[data-pin],[data-see-pin],[data-open-shot]', 'pin'],
    ['[data-clip],[data-cut],[data-angle],[data-act="journal"],[data-p2-award],[data-support-profile]', 'card'],
    ['[data-p2-pass]', 'rank'],
    ['[data-kb-save]', 'link'],
    ['[data-fly],[data-fly-auto],[data-p2-measure],[data-support-scenario],.s-replay,[data-act="film"],[data-rec-play],.p3-pause', 'progress']
  ];
  function interfaceSound(cue) {
    if (audible() && !proxyDepth) fx.play(cue, interfaceOwner);
  }
  let lastHot = null, hotTime = 0;
  function soundHotspot(button) {
    if (!audible()) return;
    const now = performance.now();
    if (button !== lastHot || now - hotTime > 480) interfaceSound('hotspot');
    lastHot = button;
    hotTime = now;
  }
  document.addEventListener('pointerover', event => {
    const button = event.target.closest('.kx-hot');
    if (event.isTrusted && button && !button.contains(event.relatedTarget)) soundHotspot(button);
  });
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const control = event.target.closest('button,a');
    if (!control || control.disabled || control.getAttribute('aria-pressed') === 'true') return;
    if (control.matches('.kx-hot')) { soundHotspot(control); return; }
    const entry = selectionSounds.find(([selector]) => control.matches(selector));
    if (entry) interfaceSound(entry[1]);
  }, true);
  document.addEventListener('change', event => {
    if (!event.isTrusted) return;
    if (event.target.matches('select[data-p3-choice]')) interfaceSound('pin');
    if (event.target.matches('#demo-p4 input[type="range"]')) interfaceSound('progress');
  }, true);
  document.addEventListener('keydown', e => {
    if (['ArrowLeft','ArrowRight'].includes(e.key) && e.isTrusted && preferred) primeMedia();
  }, true);
  window.addEventListener('knight:blocked', requireGesture);
  window.addEventListener('ride:lang', () => { clearNote(); render(); });
  let lastRoute = null;
  window.addEventListener('ride:route', event => {
    const next = event.detail;
    const changed = lastRoute && next !== lastRoute && lastRoute !== 'background' && next !== 'background';
    lastRoute = next;
    quiet(); clearNote(); render();
    if (confirmOnLanding) { confirmOnLanding = false; confirmSound(); }
    else if (changed) interfaceSound('tab');
  });
  window.addEventListener('storage', e => {
    if (e.key === prefKey || e.key === null) setPreference(e.newValue !== 'off', false);
  });
  window.addEventListener('pagehide', quiet);
  document.addEventListener('visibilitychange', () => { if (document.hidden) quiet(); });
  function tryAutoplay() {
    if (!preferred || primedByGesture || document.hidden) return;
    fx.play('soundOn',systemOwner).then(played => {
      if (!preferred || primedByGesture || !played) return;
      ready = true;
      blocked = false;
      render();
    });
  }
  render();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',tryAutoplay,{once:true});
  else tryAutoplay();
})();

function createSceneSpeaker(setPlaying = () => {}) {
  let ticket = null;
  return {
    get active() { return ticket !== null; },
    stop() { if (ticket) window.KnightVoice.stopManual(); },
    play(text, options = {}) {
      const current = {};
      let finished = false;
      const accepted = window.KnightVoice.manual(text, {
        explicit: Boolean(options.explicit),
        onEnd() {
          finished = true;
          if (ticket === current) {
            ticket = null;
            setPlaying(false);
          }
          if (options.onEnd) options.onEnd();
        }
      });
      if (accepted !== false && !finished) {
        ticket = current;
        setPlaying(true);
      }
      return accepted;
    }
  };
}

const rideMedia = {
  "product": "assets/scenes/product.57748c56284ec0.webp",
  "wear": "assets/scenes/wear.85f167b39cca38.webp",
  "pov-hud": "assets/scenes/pov-hud.9166e358d7a24a.webp",
  "tire": "assets/scenes/tire.27fd00909f964d.webp",
  "health": "assets/scenes/health.655a90299bd3ee.webp",
  "altitude": "assets/scenes/altitude.db8c573ad67469.webp",
  "crash": "assets/scenes/crash.0f82a0ad6b844d.webp",
  "weather": "assets/scenes/weather.559000082c9cdd.webp",
  "night-city": "assets/scenes/night-city.32e6bc669d70cc.webp",
  "ai-vision": "assets/scenes/ai-vision.fe3ff24d3c8b89.webp",
  "vlog": "assets/scenes/vlog.03baf1e17b27c6.webp",
  "checkin": "assets/scenes/checkin.02874222fee383.webp",
  "glasses-invite-pov": "assets/scenes/glasses-invite-pov.11c0134b661acf.webp",
  "team-map": "assets/scenes/team-map.43b24a40365264.webp",
  "team-voice": "assets/scenes/team-voice.55fd3cd4335c23.webp",
  "race": "assets/scenes/race.cbac4068f4c992.webp",
  "awards": "assets/scenes/awards.a97c41201570a0.webp",
  "call-limit": "assets/scenes/call-limit.409a00c333587f.webp",
  "album": "assets/scenes/album.57c0f08e1ca29e.webp",
  "knowledge": "assets/scenes/knowledge.2957ee83406dcf.webp",
  "kb-tire": "assets/scenes/kb-tire.11eb91b25c3e4a.webp",
  "kb-chain": "assets/scenes/kb-chain.f192997fbd97f4.webp",
  "kb-altitude": "assets/scenes/kb-altitude.2b706c723b8a8d.webp",
  "kb-rain": "assets/scenes/kb-rain.1c23c7bb13fb81.webp",
  "community": "assets/scenes/community.378d049afdface.webp",
  "flywheel": "assets/scenes/flywheel.8e0e4e4c11e157.webp",
  "hero": "assets/scenes/hero.da128ce3c39898.webp",
  "FRAME_CURVE": "assets/scenes/frame_curve.ad70157c2aafe0.webp",
  "FRAME_PASS": "assets/scenes/frame_pass.3e64d04adf2bb1.webp",
  "FRAME_ROUTE": "assets/scenes/frame_route.87985b4f1603c0.webp",
  "FILM": "assets/scenes/film.258fe4fae07003.mp4"
};
// The poster belongs to the recording page. The film itself loads on playback or seeking.
const teamFilm = document.querySelector('video[data-media-src="FILM"]');
function prepareTeamFilm() {
  if (!teamFilm.hasAttribute('src')) teamFilm.src = rideMedia.FILM;
}
window.addEventListener('ride:route', event => {
  if (event.detail === 'p4' && !teamFilm.hasAttribute('poster')) teamFilm.poster = rideMedia.FRAME_PASS;
});

function rideEngine(rootId, pageKey, startTab) {
  const root = document.getElementById(rootId);
  const find = selector => root.querySelector(selector);
  const consolePanel = find('.p1-console');
  const roadImage = find('.p1-roadphoto');
  const wear = find('.p1-wear');
  const visual = find('.p1-visual');
  const rect = find('.p1-reticle');
  const hudTitle = find('.p1-hudnote b');
  const hudSub = find('.p1-hudnote span');
  const M = k => rideMedia[k];
  const photos = {road: M('pov-hud'), tire: M('tire'), health: M('health'), altitude: M('altitude'), crash: M('crash'), weather: M('weather'), night: M('night-city'), vision: M('ai-vision'), vlog: M('vlog'), checkin: M('checkin')};
  const sensorPhoto = {brake:'road', tire:'tire', body:'health', altitude:'altitude', weather:'weather', fall:'crash'};
  const sources = {
    brake: '前车刹车灯识别 · 视觉测距 · 本车车速',
    tire: '胎压胎温传感器（气门嘴小硬件）· 实时连接眼镜',
    body: '手机健康数据 · App 车队聊天 · 骑行时长 · 天气',
    altitude: '海拔与天气 · 手机健康数据（血氧 / 心率）· 车队群聊天',
    weather: '实时天气 · 路线前方降雨与气温',
    fall: '姿态突变检测 · 定位 · 紧急联系人'
  };
  const clips = [
    ['vlog', '山谷晨雾', '今日高光 · 片段一'],
    ['vlog', '山路弯道', '今日高光 · 片段二'],
    ['vlog', '垭口日落', '今日高光 · 片段三']
  ];
  const sensorSpeech = {"brake":"前车急刹，注意车距。","tire":"后轮胎压偏低，建议在下个服务区停车检查。","body":"已经连续骑行三小时了，前方 8 公里有休息区，歇一会儿再走。","altitude":"你已到达高海拔路段，心率偏高，放慢节奏，记得补水。","weather":"前方有阵雨，弯道路面可能湿滑。","fall":"你还好吗？没有回应将自动求救。"};
  const commandSpeech = {"wechat":"老王发来微信：到哪了？垭口等你。","reply":"已经回复老王：二十分钟到。","call":"已接通妈妈的电话。","ask":"前方十二公里镇口有加油站，已为你导航。","vision":"这是沿途的一座古寺，简介和照片已存入今日生活库。","photo":"拍好了，照片已存入今日生活库。"};
  const sensors = {
    brake: ['前车急刹测距','前车急刹','刹车灯亮起，车距持续缩短。','前车距离缩短，请拉开车距。'],
    tire: ['胎压与胎温','后轮胎压下降','后轮 1.1 bar，胎温 68°C 仍在上升。','后轮胎压偏低，建议在下个服务区停车检查。'],
    body: ['疲劳监测','连续骑行 3 小时','心率偏高、昨晚睡眠不足；你在车队群说“有点困”。','已经连续骑行很久了，前方有休息区，歇一会儿再走。'],
    altitude: ['高原反应','高海拔路段','海拔 4,520 m，血氧 86%；你在群里提到“头有点疼”。','你已到达高海拔路段，心率偏高，放慢节奏，记得补水。'],
    weather: ['天气与道路环境','前方阵雨','弯道路面可能湿滑。','前方有阵雨，弯道路面可能湿滑。'],
    fall: ['疑似摔车与求助','疑似摔车','骑手有 15 秒确认安全，本页仅展示求助流程。','请确认自身状态。']
  };
  const fieldGuides = {
    weather: ['留足跟车空间。', '查看后续路况并预留时间。', '领队播报湿滑路段，约定集合点。'],
    body: ['找安全地点停车休息。', '视状态缩短当日行程。', '通知领队，在安全地点统一停靠。'],
    altitude: ['停靠后告知联系人当前状况。', '查看附近补给与医疗协助点。', '确认队友位置，按需协助联系救援。'],
    fall: ['确认周边安全，按需联系当地救援。', '记下道路名称与附近地标。', '向后方预警，核对事故位置。']
  };
  const commands = {
    wechat: ['微信播报','老王：到哪了？垭口等你','老王发来微信，眼镜已语音读出。想回复，只需说一句。'],
    reply: ['语音回复','你好骑士，回复老王「二十分钟到」','「二十分钟到」已发送给老王，双手不离把。'],
    call: ['接听来电','你好骑士，接听','妈妈来电已接通，风噪过滤开启；说「挂断」即可拒接。'],
    ask: ['问加油站','你好骑士，最近的加油站在哪？','前方 12 km 镇口有加油站，路线已投到镜片上。'],
    vision: ['识别地标','你好骑士，前面那座塔是什么？','沿途地标已识别，简介与照片存入今日生活库。'],
    photo: ['拍一张','你好骑士，拍一张','已拍摄，照片附带坐标与海拔，归入今日生活库。']

  };
  const places = ['康定','折多山','新都桥'];
  const stamps = new Set([0]);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let tab = startTab, sensor = 'brake', command = 'wechat', place = 1, journal = false;
  let timer = 0, cue = false;
  let musicContext, volume, musicInterval, clip = 0, photosTaken = 0, videosTaken = 3;
  let clipTime = 0, recording = false, recordedSeconds = 0, nextDeadline = 0;
  const voice = createSceneSpeaker(value => {
    const button = find('[data-act=voice]');
    if (button) button.textContent = value ? '停止播报' : '试听播报';
  });

  function notice(text) {
    const output = find('[data-p1-status]');
    if (output) output.textContent = text;
  }
  function stopVoice() { voice.stop(); }
  function stopMusic() {
    clearInterval(musicInterval);
    if (musicContext && musicContext.state !== 'closed') musicContext.close().catch(() => {});
    musicContext = null;
    volume = null;
  }
  window.addEventListener('knight:quiet-media', () => {
    if (!musicContext) return;
    stopMusic();
    if (tab === 'hud') nav();
  });
  function finishRecording() {
    if (recording) videosTaken++;
    recording = false;
  }
  function stopActivity() {
    clearInterval(timer);
    timer = 0;
    stopVoice();
    stopMusic();
    cue = false;
    finishRecording();
  }
  function speak(text) {
    if (voice.active) { stopVoice(); return; }
    voice.play(text, {explicit: true});
  }
  function camera(key, title, sub, alt='骑手视角的路面与镜片提示') {
    if (roadImage.getAttribute('src') !== photos[key]) roadImage.src = photos[key];
    roadImage.alt = alt;
    hudTitle.textContent = title; hudSub.textContent = sub;
  }
  function actions(items) {
    return '<div class="p1-controls">' + items.map(([key,label]) => '<button type="button" data-act="'+key+'">'+label+'</button>').join('')+'</div>';
  }
  function values(items) {
    return '<div class="p1-values">'+items.map(([label,value])=>'<span>'+label+'<b>'+value+'</b></span>').join('')+'</div>';
  }
  function chart(data, color='rgb(232,181,102)') {
    const canvas = find('.p1-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w=600,h=110;
    canvas.width=w;canvas.height=h;
    const pt=i=>[8+i*(w-16)/(data.length-1),h-8-data[i]*(h-21)];
    ctx.strokeStyle='rgba(182,192,194,.2)';ctx.lineWidth=1;
    for(let i=0;i<4;i++){const y=10+i*30;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();data.forEach((v,i)=>i?ctx.lineTo(...pt(i)):ctx.moveTo(...pt(i)));ctx.stroke();
    for(let i=0;i<data.length;i++){ctx.beginPath();ctx.fillStyle=color;ctx.arc(...pt(i),i===data.length-1?5:2.5,0,Math.PI*2);ctx.fill();}
  }
  function selectSensor() {
    const [,title,detail,reply] = sensors[sensor];
    const metrics = {brake:[['车距','18 m'],['当前车速','56 km/h']],tire:[['前轮','2.3 bar · 42°C'],['后轮','1.1 bar · 68°C']],body:[['连续骑行','3 h'],['昨晚睡眠','5.2 h'],['心率','84 bpm']],altitude:[['海拔','4,520 m'],['血氧','86%']],weather:[['天气','阵雨'],['路况','湿滑']],fall:[['应答窗口','15 s'],['求助对象','队友及联系人']]}[sensor];
    const series = {brake:[.88,.85,.77,.66,.54,.38,.18],tire:[.83,.8,.81,.74,.64,.45,.2],body:[.54,.59,.5,.67,.55,.62,.61],altitude:[.78,.74,.7,.71,.59,.45,.40],weather:[.09,.15,.21,.56,.8,.89,.83]}[sensor];
    const label={brake:'前车距离趋势',tire:'后轮胎压趋势',body:'骑手心率趋势',altitude:'血氧变化趋势',weather:'前方降雨趋势'}[sensor];
    camera(sensorPhoto[sensor],title,sensor==='brake'?'刹车灯提示 · 注意车距':detail,{brake:'前车刹车灯亮起的第一视角与镜片预警示意',tire:'车轮气门嘴上的胎压胎温传感器',body:'骑手休息时的健康数据叠加示意',altitude:'高海拔垭口上的骑手与血氧海拔叠加示意',weather:'雨天山路第一视角与天气预警示意',fall:'疑似摔车后的求助倒计时示意'}[sensor]);
    rect.hidden=sensor!=='brake';rect.firstElementChild.textContent='18 m';
    const selector='<h3>'+sensors[sensor][0]+'</h3><p class="p1-source">数据来源 · '+sources[sensor]+'</p>';
    consolePanel.innerHTML=selector+values(metrics)+(series?'<canvas class="p1-chart" role="img" aria-label="'+label+'"></canvas>':'')+'<p data-p1-status role="status">'+reply+'</p>'+actions(sensor==='brake'?[['approach','重播测距'],['voice','试听播报']]:sensor==='fall'?[['sos','查看摔车求助流程'],['voice','试听播报']]:[['voice','试听播报']]);
    const guide = fieldGuides[sensor];
    if (guide) {
      const rows = ['个人骑行','长途摩旅','车队同行'].map((profile,i) => '<dt>'+profile+'</dt><dd>'+guide[i]+'</dd>').join('');
      consolePanel.insertAdjacentHTML('beforeend','<details class="p1-guide"><summary>骑士社区 · 摩友怎么做</summary><dl>'+rows+'</dl></details>');
    }
    if (series) chart(series);
  }
  function nav() {
    camera('night',cue?'↱ 300 m':'↱ 600 m',cue?'连续右弯 · 语音引导中':'滨江夜骑路线 · 剩余 8.6 km','城市夜骑的骑手，镜片内显示转向与音乐');
    consolePanel.innerHTML='<h3>路在眼前，歌在耳边</h3>'+values([['当前速度','52 km/h'],['剩余','8.6 km'],['位置','共享中']])+
      '<div class="p1-track"><span class="p1-note" aria-hidden="true">♪</span><div><b>旅途歌单 · '+(musicContext?'播放中':'已暂停')+'</b><small>导航播报时自动压低，播报结束恢复</small></div></div>'+
      '<div class="p1-meter">音乐 · 旅途<i style="--val:'+(cue?'.18':musicContext?'.76':'0')+'"></i><b>'+(cue?'18%':musicContext?'76%':'暂停')+'</b></div>'+
      '<div class="p1-meter">导航播报<i style="--val:'+(cue?'.95':'0')+'"></i><b>'+(cue?'开启':'待机')+'</b></div>'+
      actions([['music',musicContext?'暂停音乐':'播放音乐'],['nav','听弯道提醒']])+'<p data-p1-status role="status">'+(cue?'前方连续右弯，音乐自动降低。':'导航提示结束后，音乐恢复原音量。')+'</p>';
  }
  function melody() {
    if (!window.KnightVoice.audible) return;
    if (musicContext) {stopMusic();nav();return;}
    const AudioKit=window.AudioContext||window.webkitAudioContext;
    if (!AudioKit){notice('此设备可查看导航播报时的音量变化。');return;}
    const ac=new AudioKit();
    musicContext=ac;volume=ac.createGain();volume.gain.value=cue?.018:.07;volume.connect(ac.destination);
    ac.resume().catch(()=>{});
    const notes=[261.63,329.63,392,523.25,493.88,392,329.63,293.66];let step=0;
    const playNote=()=>{const o=ac.createOscillator(),envelope=ac.createGain();o.frequency.value=notes[step++%notes.length];o.type='sine';const t=ac.currentTime;envelope.gain.setValueAtTime(.001,t);envelope.gain.exponentialRampToValueAtTime(.40,t+.045);envelope.gain.exponentialRampToValueAtTime(.001,t+.49);o.connect(envelope);envelope.connect(volume);o.start(t);o.stop(t+.5);};
    playNote();musicInterval=setInterval(playNote,545);nav();
  }
  function wake() {
    const [,prompt,receipt]=commands[command];
    camera('vision','“'+prompt+'”',command==='wechat'?'微信 · 老王 · 语音读出':command==='call'?'来电 · 妈妈 · 已接通':'AI 语音对话 · 代收消息 · 识图', '骑手停在寺塔旁，眼镜识别沿途地标');
    consolePanel.innerHTML='<h3>电话微信，不用掏手机</h3><div class="p1-strip">'+Object.entries(commands).map(([k,[name]])=>'<button type="button" data-command="'+k+'" aria-pressed="'+(command===k)+'">'+name+'</button>').join('')+'</div><div class="p1-steps">“你好骑士” <span>→</span> 听懂 · 看懂 <span>→</span> <strong>耳边回答 + 镜片回执</strong></div><p role="status" data-p1-status>'+receipt+'</p>'+actions([['voice','试听播报']]);
  }
  function film() {
    const cover = !recording && !(timer && !recording) && clipTime === 0;
    if (cover) camera('vlog','今日 Vlog 已生成','自动记录 · AI 整理成片与手帐','手机上自动生成的骑行 Vlog 与手帐');
    else camera(clips[clip][0],recording?'● REC · '+recordedSeconds+' s':clips[clip][1],recording?'骑手镜头 · 录像画面':'自动记录 · 今日高光',clips[clip][2]);
    consolePanel.innerHTML='<h3>不用按，旅途自己会留下</h3><div class="p1-steps">自动记录 <span>→</span> AI 挑选高光 <span>→</span> <strong>Vlog + 手帐</strong></div><div class="p1-strip">'+clips.map(([key,name],i)=>'<button type="button" data-clip="'+i+'" aria-label="预览'+name+'" aria-pressed="'+(clip===i)+'">'+name+'</button>').join('')+'</div>'+values([['录像',videosTaken+' 段'],['抓拍',photosTaken+' 张'],['成片预览',clipTime+' / 15 s']])+actions([['film',timer&&!recording?'暂停短片':'播放短片'],['journal',journal?'收起手帐':'生成今日手帐'],['record',recording?'结束录像':'开始录像'],['snap','镜片拍照']])+(journal?'<ol class="p1-journal" aria-label="今日手帐"><li><b>07:40 · 康定</b>晨雾里出发，气温 6°C</li><li><b>11:20 · 折多山垭口</b>4,298 m，和老王在经幡下合影</li><li><b>13:05 · 新都桥</b>服务区一碗热面，歇了 40 分钟</li><li><b>17:30 · 营地</b>今日 286 km，心情：值了</li></ol>':'')+'<p data-p1-status role="status">压弯、落日、队友回头比的手势，都被自动打标；收车后汇成短片和一页手帐。</p>';
  }
  function track() {
    camera('checkin',places[place],['康定市区 · 2,560 m','折多山垭口 · 4,298 m','新都桥镇 · 3,460 m'][place],'骑手在垭口海拔牌前庆祝打卡');
    consolePanel.innerHTML='<h3>每一公里，都算数</h3><p>康定 → 折多山 → 新都桥</p>'+values([['今日里程','286 km'],['骑行时长','5 h 18 m'],['沿途收集',stamps.size+' / 3']])+'<canvas class="p1-chart" role="img" aria-label="康定经折多山到新都桥的海拔剖面"></canvas><div class="p1-strip">'+places.map((name,i)=>'<button type="button" data-place="'+i+'" aria-pressed="'+(place===i)+'">'+name+(stamps.has(i)?' ✓':'')+'</button>').join('')+'</div>'+'<div class="p1-badges" aria-label="成就"><span class="on">首次 4,000 m+</span><span'+(stamps.size===3?' class="on"':'')+'>川西三站</span><span>318 全程</span><span>年度 10,000 km</span></div>'+actions([['stamp',stamps.has(place)?'查看打卡记录':'语音打卡'],['invite','分享并邀请同骑']])+'<p data-p1-status role="status">'+(stamps.size===3?'已解锁「川西三站」成就，沿途照片已归档。':'经过地标自动识别，打卡照片附带坐标与海拔。')+'</p>';
    chart([.20,.23,.27,.38,.48,.55,.79,.93,.84,.65,.54,.49,.44]);
  }
  function render() {
    visual.dataset.view=tab;if(wear)wear.hidden=tab!=='sense';rect.hidden=true;
    root.querySelectorAll('[data-p1-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.p1Tab===tab&&(!b.dataset.sensor||b.dataset.sensor===sensor))));
    ({sense:selectSensor,hud:nav,wake,vlog:film,checkin:track})[tab]();
    if(!reduced.matches) consolePanel.animate([{opacity:.65,transform:'translateY(3px)'},{opacity:1,transform:'none'}],{duration:190,easing:'ease-out'});
  }
  function countdown() {
    clearInterval(timer);
    nextDeadline=Date.now()+15000;
    find('[data-act=sos]').textContent='我已安全';
    function tick() {
      const left=Math.max(0,Math.ceil((nextDeadline-Date.now())/1000));
      hudTitle.textContent=left?left+' 秒':'SOS 回执示例';
      hudSub.textContent=left?'等待骑手确认':'队友与紧急联系人已获知当前位置';
      notice(left?'15 秒内可选择“我已安全”取消求助。':'求助卡附有位置和事故类型，本页不会联系救援。');
      if(!left){clearInterval(timer);timer=0;find('[data-act=sos]').textContent='重看求助过程';voice.play("求助已发送，位置已发给队友和紧急联系人。");window.KnightVoice.effect('sos');}
    }
    voice.play(sensorSpeech.fall);window.KnightVoice.effect('impact');tick();timer=setInterval(tick,250);
  }
  function replayApproach() {
    clearInterval(timer);
    const start=performance.now();rect.firstElementChild.textContent='42 m';hudTitle.textContent='前车跟踪';
    const finish=()=>{rect.firstElementChild.textContent='18 m';hudTitle.textContent='前车急刹';notice(sensors.brake[3]);voice.play(sensorSpeech.brake);window.KnightVoice.effect('alert');};
    if(reduced.matches){finish();return;}
    timer=setInterval(()=>{const ratio=Math.min((performance.now()-start)/1900,1);rect.firstElementChild.textContent=Math.round(42-24*ratio)+' m';if(ratio===1){clearInterval(timer);timer=0;finish();}},80);
  }
  root.addEventListener('change',e=>{
    if(e.target.id==='p1-sensor'){stopActivity();sensor=e.target.value;render();find('#p1-sensor').focus({preventScroll:true});}
  });
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.p1Tab){stopActivity();tab=b.dataset.p1Tab;if(b.dataset.sensor)sensor=b.dataset.sensor;render();return;}
    if(b.dataset.command){stopActivity();command=b.dataset.command;if(command==='photo')photosTaken++;if(command==='video')videosTaken++;wake();voice.play(commandSpeech[command]);const commandCue={wechat:'message',reply:'sync',call:'radio',ask:'route',vision:'found',photo:'shutter',video:'tick'}[command];
      if(commandCue)window.KnightVoice.effect(commandCue);
      find('[data-command="'+command+'"]').focus({preventScroll:true});return;}
    if(b.dataset.clip!==undefined){stopActivity();clip=Number(b.dataset.clip);clipTime=clip*5;film();find('[data-clip="'+clip+'"]').focus({preventScroll:true});return;}
    if(b.dataset.place!==undefined){place=Number(b.dataset.place);track();find('[data-place="'+place+'"]').focus({preventScroll:true});return;}
    const action=b.dataset.act;
    switch(action){
      case 'voice': speak(tab==='wake'?commandSpeech[command]:sensorSpeech[sensor]);break;
      case 'approach': replayApproach();break;
      case 'sos': if(timer){clearInterval(timer);timer=0;selectSensor();hudTitle.textContent='骑手已确认安全';notice('已确认安全，倒计时结束。');voice.play("收到，本次求助已取消。");}else countdown();break;
      case 'music': melody();break;
      case 'nav':
        if(!musicContext) melody();
        clearInterval(timer);stopVoice();cue=true;
        if(volume)volume.gain.setTargetAtTime(.018,musicContext.currentTime,.10);
        nav();
        voice.play("前方三百米，连续右弯，请留意路况。", {onEnd() {
          cue=false;
          if(volume)volume.gain.setTargetAtTime(.07,musicContext.currentTime,.22);
          if(tab==='hud')nav();
        }});
        break;
      case 'stamp': if(!stamps.has(place)){voice.play(["康定打卡完成，照片与坐标已同步。","折多山打卡完成，照片与坐标已同步。","新都桥打卡完成，照片与坐标已同步。"][place]);window.KnightVoice.effect('stamp');} stamps.add(place);track();notice(places[place]+' · 已同步照片、海拔与坐标。'+(stamps.size===3?'已解锁「川西三站」成就。':''));break;
      case 'snap': photosTaken++;film();voice.play("拍好了，照片已存入今日生活库。");window.KnightVoice.effect('shutter');notice('照片已归入今日生活库。');break;
      case 'journal': journal=!journal;film();if(journal)voice.play("今日手帐已生成。");notice(journal?'今日手帐已按时间与地点自动排好。':'手帐已收起。');break;
      case 'invite': voice.play("同骑邀请卡已生成。");window.KnightVoice.effect('message');notice('邀请卡已生成：“下周末一起跑 318？” 摩友点开即可加入你的车队。');break;
      case 'record':
        clearInterval(timer);timer=0;
        if(recording){finishRecording();film();voice.play("录像已保存。");window.KnightVoice.effect('sync');notice('录像已同步至今日素材。');break;}
        recording=true;recordedSeconds=0;film();voice.play("开始录像。");window.KnightVoice.effect('tick');timer=setInterval(()=>{recordedSeconds++;hudTitle.textContent='● REC · '+recordedSeconds+' s';},1000);break;
      case 'film':
        if(timer&&!recording){clearInterval(timer);timer=0;film();break;}
        clearInterval(timer);finishRecording();if(clipTime>=15)clipTime=0;
        clip=Math.min(2,Math.floor(clipTime/5));
        timer=setInterval(()=>{
          clipTime++;
          clip=Math.min(2,Math.floor(clipTime/5));
          camera(clips[clip][0],clips[clip][1],'云端 AI 精选 · 每日生活库',clips[clip][2]);
          find('.p1-values span:last-child b').textContent=clipTime+' / 15 s';
          root.querySelectorAll('[data-clip]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.clip)===clip)));
          if(clipTime>=15) {
            clearInterval(timer);timer=0;
            find('[data-act=film]').textContent='播放短片';
          }
        },1000);
        film();break;
    }
    if(action&&action!=='voice'){const replacement=find('[data-act="'+action+'"]');if(replacement&&replacement!==b)replacement.focus({preventScroll:true});}
  });
  window.addEventListener('ride:route',e=>{if(e.detail!==pageKey){stopActivity();}else render();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopActivity();if(!root.closest('[hidden]'))render();}});
  render();
}
rideEngine('demo-p1','p1','sense');
rideEngine('demo-p5','p5','hud');


(() => {
  const root = document.getElementById('demo-p2');
  const find = s => root.querySelector(s);
  const all = s => [...root.querySelectorAll(s)];
  const photos = {
    crew: [rideMedia['team-map'], '五台摩托车编队骑行的航拍画面'],
    sunset: [rideMedia['race'], '车队竞技挑战中的骑手们'],
    voice: [rideMedia['team-voice'], '同路两支车队通过眼镜语音互致问候'],
    awards: [rideMedia['awards'], '收车后在高原湖边击掌庆祝的车队']
  };
  const metadata = {
    group: ['App 组队', '手机端 · 拉群', 'crew'],
    rank: ['编队 HUD', '封闭路段', 'crew'],
    challenge: ['山海挑战', '路线剖面示意', 'sunset'],
    greet: ['同路雷达', '车队语音频道', 'voice'],
    awards: ['车队生活库', '收车 · 今日结算', 'awards']
  };
  const honors = {
    climber: ['老王 · 今日爬升王', '累计爬升 2,680 m', 'awards'],
    escort: ['阿哲 · 最稳护航官', '全程压队，零掉队', 'awards'],
    camera: ['老周 · 最佳第一视角', '贡献 4 段云海高光', 'awards']
  };
  const measures = { km:[1420,1185,'km'], pass:[12,9,'座'], up:[2680,2240,'m'] };
  const glance = find('[data-p2-glance]');
  const image = find('[data-p2-photo]');
  const radar = find('[data-p2-radar]');
  const profile = find('[data-p2-profile]');
  const note = find('[data-p2-note]');
  let tab = 'group', measure = 'km', honor = 'climber', joined = 2;
  const crewNames = ['老王 · 领队', '我', '老周', '阿哲', '小林'];
  function renderInvite(fresh) {
    find('[data-ph-members]').innerHTML = crewNames.map((n, i) => '<li class="' + (i < joined ? 'on' : '') + (fresh && i === joined - 1 && i > 1 ? ' new' : '') + '"><b>' + n.slice(0, 1) + '</b><span>' + n + '</span><small>' + (i < joined ? '已入队' : '邀请中') + '</small></li>').join('');
    find('[data-ph-foot]').textContent = joined >= 5 ? '位置共享 · 已开启（5 / 5）' : '位置共享 · 待全员入队（' + joined + ' / 5）';
    find('[data-pov-status]').textContent = joined > 2 ? crewNames[joined - 1].split(' ')[0] + ' 已加入车队' : '已发送给老王';
    find('[data-p2-group-status]').textContent = joined >= 5 ? '5 / 5 人到齐 · 位置与排名同步到每副眼镜' : joined + ' / 5 人已入队 · 眼镜播报：“' + crewNames[joined - 1].split(' ')[0] + ' 已加入”';
  }
  let passed = false, checked = false, greetingTimer = 0;
  const teamVoice = createSceneSpeaker();

  function setPhoto(key) {
    if (image.dataset.photo === key) return;
    image.dataset.photo = key;
    [image.src, image.alt] = photos[key];
  }
  function paintGlance() {
    const [device, context, photo] = metadata[tab];
    find('[data-p2-device]').textContent = device;
    find('[data-p2-context]').textContent = context;
    setPhoto(tab === 'awards' ? honors[honor][2] : photo);
    const inviteView = find('[data-p2-invite-view]');
    inviteView.hidden = tab !== 'group'; image.hidden = tab === 'group'; glance.hidden = tab === 'group';
    find('.p2-screen-top').hidden = tab === 'group';
    if (tab === 'group') renderInvite(false);
    radar.hidden = tab !== 'greet';
    profile.hidden = tab !== 'challenge';
    note.hidden = tab !== 'rank' || !passed;
    if (tab === 'rank') {
      glance.innerHTML = '<div class="p2-glance-rank"><b>' + (passed ? 'P1' : 'P2') + '</b><span>' + (passed ? '领队位置' : '距领队 0.8 km') + '</span></div>';
      return;
    }
    const title = tab === 'group' ? joined + ' / 5 人已入队' : tab === 'awards' ? honors[honor][1] : tab === 'challenge' ? (checked ? '2 / 2 座垭口' : '1 / 2 座垭口') : '200 m · 同向';
    const label = tab === 'group' ? '川西 318 小队 · 邀请码 KN318' : tab === 'awards' ? honors[honor][0] : tab === 'challenge' ? '今日垭口挑战' : '前方发现川西车队';
    glance.innerHTML = '<span class="p2-place">' + label + '</span><h3>' + title + '</h3>';
  }
  function refreshRank() {
    const order = passed ? ['02','01','03','04'] : ['01','02','03','04'];
    const gaps = ['领队', passed ? '+0.3 km' : '+0.8 km', '+1.6 km', '+2.3 km'];
    const list = find('.p2-leaderboard');
    order.forEach((id, index) => {
      const row = list.querySelector('[data-rider="' + id + '"]');
      row.style.setProperty('--slot', index);
      row.querySelector('b').textContent = 'P' + (index + 1);
      row.querySelector('small').textContent = gaps[index];
      row.setAttribute('aria-posinset',index+1);
      row.setAttribute('aria-setsize',4);
    });
    find('[data-p2-pass]').textContent = passed ? '还原排位' : '查看超车抓拍';
  }
  function paintChart() {
    const [base, other, unit] = measures[measure];
    const values = [base + (checked && measure === 'pass' ? 1 : 0), other];
    all('.p2-gauge').forEach((row,index) => {
      row.querySelector('strong').textContent = values[index].toLocaleString('en-US') + ' ' + unit;
      row.querySelector('.p2-track i').style.transform = 'scaleX(' + values[index] / (Math.max(...values) * 1.08) + ')';
    });
    all('[data-p2-measure]').forEach(button => button.setAttribute('aria-pressed',button.dataset.p2Measure === measure));
  }
  function drawProfile() {
    const ctx = profile.getContext('2d');
    if (!ctx) return;
    const y = [76,66,68,49,56,45,32,38,21,8,19,42,35,40,54,42,30,19,22,4,21,36,34,47,60,57,64];
    const xAt = i => 6 + i * (638/(y.length-1));
    ctx.clearRect(0,0,650,85);
    ctx.beginPath();y.forEach((v,i) => { if(i) ctx.lineTo(xAt(i),v);else ctx.moveTo(xAt(i),v); });
    ctx.strokeStyle='rgb(255,204,126)';ctx.lineWidth=3;ctx.stroke();
    ctx.lineTo(644,84);ctx.lineTo(6,84);ctx.closePath();ctx.fillStyle='rgba(249,185,97,.18)';ctx.fill();
    [9,19].forEach((v,i) => {ctx.beginPath();ctx.arc(xAt(v),y[v]+1,4,0,2*Math.PI);ctx.fillStyle= i === 1 && !checked ? 'rgb(59,54,48)' : 'rgb(255,204,126)';ctx.fill();ctx.strokeStyle='rgb(255,204,126)';ctx.lineWidth=2;ctx.stroke();});
  }
  function stopVoice() {
    clearTimeout(greetingTimer);
    radar.classList.remove('is-pinging');
    teamVoice.stop();
  }
  function changeTab(next) {
    stopVoice();
    tab = next;
    all('[data-p2-tab]').forEach(button => button.setAttribute('aria-pressed',button.dataset.p2Tab === tab));
    all('[data-p2-panel]').forEach(panel => { panel.hidden = panel.dataset.p2Panel !== tab;panel.classList.toggle('p2-screen-change',!panel.hidden); });
    paintGlance();
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.p2Tab) {
      if (button.dataset.p2Tab === 'awards' && window.KnightVoice.audible)
        window.KnightFoley.warm(['tally','medal1','medal2','medal3','medal4']);
      return changeTab(button.dataset.p2Tab);
    }
    if (button.hasAttribute('data-p2-invite')) {
      joined = joined >= 5 ? 2 : joined + 1;
      button.textContent = joined >= 5 ? '重新组队' : '邀请下一位队友';
      renderInvite(true);
      if(joined>2){teamVoice.play(["老周已加入车队。","阿哲已加入车队。","小林已加入，五人到齐。"][joined-3]);window.KnightVoice.effect('joined');}
      return;
    }
    if (button.hasAttribute('data-p2-pass')) {
      passed = !passed;refreshRank();paintGlance();if(passed)teamVoice.play("你已超过老王，升至第一。");
      find('[data-p2-rank-status]').textContent = passed ? '我升至 P1，超车片段已标记并存入云端。' : '已还原编队顺序。';
    } else if (button.hasAttribute('data-p2-join')) {
      find('[data-p2-rank-status]').textContent = '“你好骑士，编队 318” · 四辆车已加入同一语音频道。';
      button.textContent = '重播组队指令';teamVoice.play("四辆车已加入同一语音频道。");window.KnightVoice.effect('joined');
    } else if (button.dataset.p2Measure) {
      measure = button.dataset.p2Measure;paintChart();
    } else if (button.hasAttribute('data-p2-check')) {
      checked = !checked;paintChart();paintGlance();drawProfile();if(checked){teamVoice.play("第二座垭口打卡成功，云端骑士徽章已解锁。");window.KnightVoice.effect('stamp');}
      button.textContent = checked ? '重置挑战' : '打卡第二座垭口';
      find('[data-p2-quest]').textContent = checked ? '2 / 2 座 · 已解锁云端骑士徽章' : '1 / 2 座 · 云端骑士徽章待解锁';
    } else if (button.hasAttribute('data-p2-greet')) {
      stopVoice();
      radar.classList.add('is-pinging');
      const reply = '兄弟一路顺风，前面垭口云海绝美！';
      find('[data-p2-reply]').textContent = '对方回复 · “' + reply + '”';
      button.textContent = '再听一次致意';
      teamVoice.play(reply);window.KnightVoice.effect('radio');
      greetingTimer = setTimeout(() => radar.classList.remove('is-pinging'),1800);
    } else if (button.dataset.p2Award) {
      honor = button.dataset.p2Award;
      all('[data-p2-award]').forEach(item => item.setAttribute('aria-pressed',item === button));
      paintGlance();
    } else if (button.hasAttribute('data-p2-share')) {
      find('[data-p2-shared]').hidden = false;teamVoice.play("今日高光榜已生成，已分享到车队群。");window.KnightVoice.effect('sync');
      button.textContent = '已生成车队分享卡';
      button.disabled = true;
    }
  });
  window.addEventListener('ride:route',event => { if(event.detail !== 'p2') stopVoice(); });
  window.addEventListener('pagehide',stopVoice);
  refreshRank();paintChart();drawProfile();paintGlance();
})();


(() => {
  const root = document.getElementById('demo-p3');
  const find = selector => root.querySelector(selector);
  const map = find('.p3-map');
  const terrain = find('.p3-terrain');
  const riders = find('.p3-crew');
  const terrainContext = terrain.getContext('2d');
  const riderContext = riders.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const pause = find('.p3-pause');
  const trigger = find('.p3-trigger');
  const status = find('.p3-status');
  const select = find('[data-p3-choice]');
  const speak = find('.p3-voice');
  const route = [
    [0.075, 0.815], [0.145, 0.781], [0.182, 0.709], [0.205, 0.635],
    [0.182, 0.553], [0.224, 0.498], [0.282, 0.527], [0.334, 0.627],
    [0.393, 0.654], [0.435, 0.609], [0.424, 0.507], [0.390, 0.428],
    [0.407, 0.342], [0.468, 0.320], [0.531, 0.403], [0.586, 0.482],
    [0.642, 0.461], [0.688, 0.356], [0.745, 0.311], [0.803, 0.353],
    [0.862, 0.306], [0.908, 0.220], [0.945, 0.192]
  ];
  const contourHills = [
    [0.08, 0.14, 0.31, 0.37, 0.77], [0.24, 0.20, 0.26, 0.17, 0.49],
    [0.38, 0.01, 0.25, 0.25, 0.55], [0.48, 0.94, 0.38, 0.24, 0.68],
    [0.76, 0.66, 0.20, 0.29, 0.52], [0.90, 0.72, 0.21, 0.35, 0.58],
    [0.86, 0.04, 0.19, 0.19, 0.43], [0.03, 0.77, 0.16, 0.18, 0.28]
  ];
  const placeNames = [
    { t: 0.015, name: '康定', x: 8, y: 21, align: 'left' },
    { t: 0.27, name: '折多塘', x: -8, y: 23, align: 'right' },
    { t: 0.99, name: '折多山垭口', x: -12, y: -14, align: 'right' },
  ];
  function heightAt(x, y) {
    let height = 0.1 * Math.sin(x * 13 + y * 8)
      + 0.076 * Math.cos(x * 22 - y * 21)
      + 0.041 * Math.sin(x * 54 + y * 34)
      + 0.025 * Math.cos(x * 80 - y * 49);
    for (const [centerX, centerY, spreadX, spreadY, strength] of contourHills) {
      const horizontal = (x - centerX) / spreadX;
      const vertical = (y - centerY) / spreadY;
      height += strength * Math.exp(-horizontal * horizontal - vertical * vertical);
    }
    return height;
  }

  function buildPath(width, height) {
    const points = [];
    const interpolate = (a, b, c, d, t) =>
      (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * (b - c) + d - a) * t * t * t) / 2;
    for (let index = 0; index < route.length - 1; index++) {
      const a = route[Math.max(0, index - 1)];
      const b = route[index];
      const c = route[index + 1];
      const d = route[Math.min(index + 2, route.length - 1)];
      for (let step = 0; step < 12; step++) {
        const t = step / 12;
        points.push([interpolate(a[0], b[0], c[0], d[0], t) * width, interpolate(a[1], b[1], c[1], d[1], t) * height]);
      }
    }
    points.push([route.at(-1)[0] * width, route.at(-1)[1] * height]);
    return points;
  }

  function pointAt(progress) {
    const index = progress * (line.length - 1);
    const from = line[Math.floor(index)];
    const to = line[Math.ceil(index)];
    return [from[0] + (to[0] - from[0]) * (index % 1), from[1] + (to[1] - from[1]) * (index % 1)];
  }

  function traceRoute(context, start = 0, end = 1) {
    context.beginPath();
    context.moveTo(...pointAt(start));
    for (let index = Math.ceil(start * (line.length - 1)); index < end * (line.length - 1); index++) {
      context.lineTo(...line[index]);
    }
    context.lineTo(...pointAt(end));
  }

  function drawTerrain() {
    const { width, height } = size;
    const context = terrainContext;
    const columns = 145;
    const rows = 104;
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    const elevations = Array.from({ length: rows + 1 }, (_, y) =>
      Array.from({ length: columns + 1 }, (_, x) => heightAt(x / columns, y / rows))
    );
    const texture = document.createElement('canvas');
    texture.width = columns;
    texture.height = rows;
    const textureContext = texture.getContext('2d');
    const wash = textureContext.createImageData(columns, rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const elevation = elevations[y][x];
        const shadow = (elevations[y][x] - elevations[y + 1][x + 1]) * 250;
        const grain = Math.sin((x * 31.4 + y * 19.7) * 2.4) * 2;
        const light = Math.min(19, Math.max(-13, elevation * 15 + shadow + grain));
        const offset = (y * columns + x) * 4;
        wash.data.set([32 + light, 34 + light, 29 + light * 0.82, 255], offset);
      }
    }
    textureContext.putImageData(wash, 0, 0);
    context.drawImage(texture, 0, 0, width, height);

    for (let level = 0.096; level < 1.55; level += 0.035) {
      context.beginPath();
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
          const a = elevations[y][x];
          const b = elevations[y][x + 1];
          const c = elevations[y + 1][x + 1];
          const d = elevations[y + 1][x];
          if (level < Math.min(a, b, c, d) || level > Math.max(a, b, c, d)) continue;
          const corners = [
            [x, y, a], [x + 1, y, b], [x + 1, y + 1, c], [x, y + 1, d]
          ];
          const hits = [];
          for (let edge = 0; edge < 4; edge++) {
            const [ax, ay, a] = corners[edge];
            const [bx, by, b] = corners[(edge + 1) % 4];
            if ((a < level) === (b < level)) continue;
            const fraction = (level - a) / (b - a);
            hits.push([(ax + (bx - ax) * fraction) * cellWidth, (ay + (by - ay) * fraction) * cellHeight]);
          }
          for (let index = 0; index < hits.length; index += 2) {
            context.moveTo(...hits[index]);
            context.lineTo(...hits[index + 1]);
          }
        }
      }
      context.lineWidth = 0.65;
      context.strokeStyle = 'rgba(185, 179, 149, .18)';
      context.stroke();
    }

    const shade = context.createLinearGradient(0, 0, width * .72, height);
    shade.addColorStop(0, 'rgba(13, 16, 13, .42)');
    shade.addColorStop(.46, 'rgba(13, 16, 13, .08)');
    shade.addColorStop(1, 'rgba(13, 16, 13, .35)');
    context.fillStyle = shade;
    context.fillRect(0, 0, width, height);

    context.lineCap = 'round';
    context.lineJoin = 'round';
    traceRoute(context);
    context.strokeStyle = 'rgba(15, 13, 9, .84)';
    context.lineWidth = 8;
    context.stroke();
    context.strokeStyle = 'rgb(159, 133, 72)';
    context.lineWidth = 2.3;
    context.stroke();

    placeNames.forEach(({ t, name, x, y, align }) => {
      const [anchorX, anchorY] = pointAt(t);
      context.beginPath();
      context.arc(anchorX, anchorY, 3.4, 0, Math.PI * 2);
      context.fillStyle = 'rgb(238, 210, 153)';
      context.fill();
      context.font = (width < 420 ? '11px' : '12px') + ' system-ui, sans-serif';
      context.textAlign = align;
      context.lineWidth = 3;
      context.strokeStyle = 'rgba(19, 22, 16, .9)';
      context.fillStyle = 'rgb(220, 215, 187)';
      context.strokeText(name, anchorX + x, anchorY + y);
      context.fillText(name, anchorX + x, anchorY + y);
    });
  }

  function circle(context, x, y, radius, fill, stroke) {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    if (fill) {
      context.fillStyle = fill;
      context.fill();
    }
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = 1;
      context.stroke();
    }
  }

  let mode = 'dropoff';
  let active = false;
  let playing = !reduced.matches;
  let elapsed = 0;
  let raf = 0;
  let lastTime = 0;
  let lastPaint = 0;
  let line = [];
  let size = { width: 0, height: 0, ratio: 1 };
  let queuedAlert = null;
  const state = { rally: false, rescue: false, restored: false, fuel: false, slow: false, hazard: '碎石', incident: '摔车', received: 0 };
  const incidents = {
    '摔车': '确认现场安全，联系当地救援。',
    '高原不适': '在安全地点会合，协助联系当地医疗服务。',
    '爆胎': '标记车辆位置，在安全地点等待协助。',
    '长途疲劳': '联络骑手，约定安全休息点。',
    '雨天受困': '标记积水位置，在安全地点会合。'
  };
  const scenarios = {
    dropoff: {heading:'03 号车落后 1.5 km', sub:'领队可在镇口设置集合点，全队同步导航。', legend:'03 号车掉队', link:'队内位置同步', idle:'全队镜片标出掉队车辆的方位，并提醒领队。', action:'设置集合点'},
    sos: {heading:'03 号车发出 SOS', sub:'将事件与坐标发给全队，为最近的 04 号车规划返回路线。', legend:'03 求援 · 04 最近', link:'最近队友协助', idle:'03 号车坐标与事件已同步至全队镜片。', action:'查看返回路线'},
    hazard: {heading:'后车提前 300 m 收到提醒',sub:'领队通过语音标记路况，后车靠近标记点时收到镜片和语音预警。',legend:'领队路况标记',link:'队内语音频道',idle:'选择路况，听领队为后车标记危险。',action:'语音标记路况'},
    call: {heading:'车速 68 km/h · 自由通话已收起',sub:'骑得快时只保留一键预警，语音消息自动转成播报；低速或停车后恢复双向通话。',legend:'通话限速保护',link:'队内语音',idle:'高速状态：仍可一键发送「前方危险」「我要停车」等预警。',action:'减速至 25 km/h'},
    offline: {heading:'蜂窝信号 0 格',sub:'四台眼镜切入 P2P 直连，位置和告警逐车接力。',legend:'P2P 离线直连',link:'设备直连',idle:'遇险报文已在队内送达，等待恢复信号后补传云端。',action:'查看联网后的消息'},
    fuel: {heading:'02 号车油量剩余 18%',sub:'对照油量、续航与体能负荷，选择前方顺路的补给点。',legend:'镇口加油站 · 12 km',link:'AI 补给建议',idle:'已找到前方 12 km 镇口加油站，可向全队发送集结广播。',action:'发起加油集结'}
  };

  const rows = find('.p3-rows');
  function renderRows() {
    const table = {
      dropoff: [['01 · 领队','领航'], ['02 · 我','编队中'], ['03 · 小北','落后领队 1.5 km'], ['04 · 收尾','保持联络']],
      sos: [['求援位置','G318 · 折多塘东'], ['最近队友','04 号 · 约 300 m'], ['应急经验库',incidents[state.incident]]],
      hazard: [['标记人','01 号 · 领队'], ['路况',state.hazard], ['触发距离','距离标记点 300 m']],
      call: [['当前车速', state.slow ? '25 km/h' : '68 km/h'], ['自由通话', state.slow ? '已开放 · 可接通领队' : '已限制'], ['一键预警','始终可用'], ['语音消息','自动转为播报']],
      offline: [['蜂窝网络', state.restored ? '已连接' : '无信号'], ['近距直连','4 / 4 台在线'], ['云端补传',state.restored ? '已同步 2 条' : '暂存 2 条报文']],
      fuel: [['01 · 165 km · 负荷平稳',74], ['02 · 39 km · 建议补给',18], ['03 · 138 km · 负荷平稳',62], ['04 · 129 km · 负荷平稳',58]]
    };
    rows.replaceChildren(...table[mode].map(([label, value]) => {
      const li=document.createElement('li'), key=document.createElement('span'), val=document.createElement('b');
      key.textContent=label;
      if(typeof value === 'number') {
        val.className='p3-meter';
        const meter=document.createElement('i');
        meter.setAttribute('aria-hidden','true');
        meter.style.setProperty('--fill',value+'%');
        val.append(meter,value+'%');
      } else val.textContent=value;
      li.append(key,val);
      return li;
    }));
  }
  function receipt() {
    if(mode==='dropoff' && state.rally) return '镇口集合点已建立，4 台眼镜已同步导航。';
    if(mode==='sos' && state.rescue) return '04 号车已收到返回路线、03 号车坐标与应急指引。';
    if(mode==='call' && state.slow) return '已接通领队通话，风噪过滤开启；车速回升后自动收起。';
    if(mode==='offline' && state.restored) return '蜂窝网络恢复，2 条离线报文已补传至云端。';
    if(mode==='fuel' && state.fuel) return '集结广播已送达 4 台眼镜，导航目的地已同步为镇口加油站。';
    if(mode==='hazard' && state.received) return state.hazard+'预警 · '+state.received+'/3 名后方队友已收到。';
    return scenarios[mode].idle;
  }

  function updatePanel() {
    const scene=scenarios[mode];
    find('[data-p3-heading]').textContent=mode==='offline' && state.restored ? '网络恢复，报文已补传' : mode==='call' && state.slow ? '低速 25 km/h · 已恢复双向通话' : scene.heading;
    find('.p3-photo').hidden=mode!=='call'; find('.p3-shade').hidden=mode!=='call'; map.classList.toggle('is-call',mode==='call');
    find('[data-p3-sub]').textContent=scene.sub;
    find('[data-p3-link]').textContent=scene.link;
    find('[data-p3-legend]').textContent=mode==='dropoff' && state.rally ? '前方镇口集合' : scene.legend;
    const hasChoice=mode==='hazard' || mode==='sos';
    find('[data-p3-choice-wrap]').hidden=!hasChoice;
    if(hasChoice) {
      const hazards=['碎石','暗冰积水','大车淋水','落石','深泥'];
      const options=mode==='sos' ? Object.keys(incidents) : hazards;
      find('[data-p3-choice-name]').textContent=mode==='sos' ? '遇险事件' : '路况标记';
      select.replaceChildren(...options.map(value=>new Option(value,value)));
      select.value=mode==='sos' ? state.incident : state.hazard;
    }
    renderRows();
    trigger.textContent=mode==='offline' && state.restored ? '进入无信号路段' : mode==='call' && state.slow ? '查看 68 km/h 时的通话状态' : scene.action;
    status.textContent=receipt();
    drawRiders();
  }

  function crewPositions() {
    const base=mode==='dropoff' ? [.757,.665,.385,.50] : mode==='sos' ? [.745,.647,.420,.478] : [.746,.646,.539,.448];
    return base.map((p,index)=>p+Math.sin(elapsed/3400+index*.23)*.012);
  }
  const gold='rgb(245,202,122)',red='rgb(250,158,123)',green='rgb(151,216,173)';
  function flag(ctx, progress, text, color) {
    const [x,y]=pointAt(progress);
    ctx.save();
    circle(ctx,x,y,4,color);
    ctx.strokeStyle=color;
    ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(x,y-4); ctx.lineTo(x,y-24); ctx.stroke();
    ctx.font='600 12px system-ui';
    const w=ctx.measureText(text).width+12;
    const left=Math.max(6,Math.min(size.width-w-6,x-w*.5));
    ctx.fillStyle='rgba(21,22,18,.95)'; ctx.fillRect(left,y-43,w,20);
    ctx.textAlign='center'; ctx.fillStyle=color; ctx.textBaseline='middle'; ctx.fillText(text,left+w/2,y-33);
    ctx.restore();
  }
  function drawRiders() {
    if(!size.width || !line.length) return;
    const ctx=riderContext, p=crewPositions(), mobile=size.width<440;
    const radius=mobile ? 9 : 12;
    ctx.clearRect(0,0,size.width,size.height);
    ctx.lineCap='round';
    const stroke=(a,b,color,weight,dash=[])=>{
      ctx.save(); ctx.setLineDash(dash); ctx.lineWidth=weight; ctx.strokeStyle=color;
      traceRoute(ctx,Math.min(a,b),Math.max(a,b)); ctx.stroke(); ctx.restore();
    };
    stroke(Math.min(...p),p[0],gold,2.5);
    if(mode==='dropoff') {
      stroke(p[2],p[3],red,3,[4,5]);
      flag(ctx,state.rally ? .90 : p[2],state.rally?'集合点':'落后 1.5 km',state.rally?gold:red);
    }
    if(mode==='sos') {
      stroke(p[2],p[3],state.rescue?green:red,4,state.rescue?[]:[5,5]);
      flag(ctx,p[2],state.rescue?'救援返回线':'SOS',state.rescue?green:red);
    }
    if(mode==='fuel') {
      flag(ctx,.90,'加油站 12 km',gold);
      if(state.fuel) stroke(p[1],.90,gold,3,[6,4]);
    }
    if(mode==='offline') {
      ctx.save(); ctx.lineWidth=1.8; ctx.strokeStyle=green; ctx.setLineDash([4,5]); ctx.beginPath();
      p.forEach((v,i)=>{const xy=pointAt(v);if(i===0)ctx.moveTo(...xy);else ctx.lineTo(...xy);});
      ctx.stroke(); ctx.restore();
    }
    if(mode==='hazard' && (queuedAlert || state.received)) {
      flag(ctx,.80,state.hazard,red);
      const rate=queuedAlert?queuedAlert.progress:1;
      const end=p[0]+(p[3]-p[0])*rate;
      stroke(end,p[0],red,3.5);
      if(queuedAlert){const [x,y]=pointAt(end);circle(ctx,x,y,radius+5,'rgba(248,151,81,.25)',red);}
    }
    p.forEach((position,index)=>{
      const [x,y]=pointAt(position);
      const warning=(index===2 && ['sos','dropoff'].includes(mode))||(mode==='fuel' && index===1);
      const color=warning?red:mode==='offline'?green:gold;
      if(warning || index===1)circle(ctx,x,y,radius+4,null,color);
      circle(ctx,x,y,radius,warning||index===1?color:'rgb(32,33,27)',color);
      ctx.font='bold '+(mobile?9:11)+'px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillStyle=warning||index===1?'rgb(35,30,22)':color;ctx.fillText('0'+(index+1),x,y);
    });
  }
  function resize() {
    const width=map.clientWidth, height=map.clientHeight, ratio=Math.min(devicePixelRatio||1,2);
    if(!active || !width || !height || (size.width===width && size.height===height && size.ratio===ratio))return;
    size={width,height,ratio};
    for(const canvas of [terrain,riders]) {
      canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
      canvas.getContext('2d').scale(ratio,ratio);
    }
    line=buildPath(width,height);
    drawTerrain();drawRiders();
  }
  function stepRelay(progress) {
    const n=Math.min(3,Math.floor(progress*3));
    if(n!==state.received || progress===1) {
      state.received=n;
      status.textContent=state.hazard+'预警 · '+n+'/3 名后方队友已收到。';
    }
    if(progress===1){queuedAlert=null;trigger.disabled=false;}else queuedAlert.progress=progress;
  }
  function tick(now) {
    raf=0;
    if(!active || document.hidden)return;
    const delta=lastTime? Math.min(80, now-lastTime):0; lastTime=now;
    if(playing)elapsed+=delta;
    if(queuedAlert){queuedAlert.ms+=delta;stepRelay(Math.min(1,queuedAlert.ms/1900));}
    if(now-lastPaint>32){drawRiders();lastPaint=now;}
    if(playing||queuedAlert)raf=requestAnimationFrame(tick);
  }
  function resume(){
    if(active&&!document.hidden&&!raf&&(playing||queuedAlert)){lastTime=0;raf=requestAnimationFrame(tick);}
  }
  function stopRun(){cancelAnimationFrame(raf);raf=0;lastTime=0;}
  function updatePause(){pause.hidden=reduced.matches;pause.textContent=playing?'暂停队形':'继续队形';}
  function playingVoice(on){speak.setAttribute('aria-pressed',String(on));speak.textContent=on?'停止播报':'试听播报';}
  const voice=createSceneSpeaker(playingVoice);
  const crewSpeech={"dropoff":"三号车落后一点五公里，请全队留意队形，听从领队集结指引。","callFast":"车速较快，队内语音已转为播报。","callSlow":"车速已降低，领队通话已接通。","online":"网络已恢复，离线报文已同步到云端。","offline":"无信号，已切换眼镜直连。","fuel":"二号车油量百分之十八，建议在前方十二公里的镇口加油站集结。","rally":"镇口集合点已设置，路线已同步给全队。","rescue":"四号车已收到返回路线，请前往协助三号车。","fuelMeet":"二号车油量百分之十八，全队在镇口加油站集结。","danger":"前方危险，注意减速。","shared":"当前事件和位置已发送给全队。"};
  const hazardSpeech={"碎石":"前方三百米有碎石，注意减速。","暗冰积水":"前方三百米有暗冰和积水，注意减速。","大车淋水":"前方三百米有大车溅水，注意减速。","落石":"前方三百米有落石，注意减速。","深泥":"前方三百米有深泥，注意减速。"};
  const rescueSpeech={"摔车":"三号车报告摔车，四号车距离最近。确认现场安全，联系当地救援。","高原不适":"三号车报告高原不适，四号车距离最近。在安全地点会合，协助联系当地医疗服务。","爆胎":"三号车报告爆胎，四号车距离最近。标记车辆位置，在安全地点等待协助。","长途疲劳":"三号车报告长途疲劳，四号车距离最近。联络骑手，约定安全休息点。","雨天受困":"三号车报告雨天受困，四号车距离最近。标记积水位置，在安全地点会合。"};
  function stopVoice() { voice.stop(); }
  function sceneMessage() {
    switch(mode) {
      case 'hazard': return hazardSpeech[state.hazard];
      case 'sos': return rescueSpeech[state.incident];
      case 'call': return state.slow ? crewSpeech.callSlow : crewSpeech.callFast;
      case 'offline': return state.restored ? crewSpeech.online : crewSpeech.offline;
      default: return crewSpeech[mode];
    }
  }
  function announce() {
    if(voice.active) { stopVoice(); return; }
    const line=sceneMessage();
    status.textContent='播报字幕 · '+line;
    voice.play(line, {explicit:true});
  }
  select.addEventListener('change',()=>{
    stopVoice();queuedAlert=null;trigger.disabled=false;
    if(mode==='sos'){state.incident=select.value;state.rescue=false;}
    else{state.hazard=select.value;state.received=0;}
    updatePanel();
    voice.play(sceneMessage());
  });
  root.querySelectorAll('[data-p3-mode]').forEach(button=>button.addEventListener('click',()=>{
    stopVoice();if(queuedAlert)stepRelay(1);
    mode=button.dataset.p3Mode;
    for(const b of root.querySelectorAll('[data-p3-mode]'))b.setAttribute('aria-pressed',String(b===button));
    updatePanel();
    if(!reduced.matches)find('.p3-console').animate([{opacity:.55,transform:'translateY(3px)'},{opacity:1,transform:'none'}],{duration:220,easing:'cubic-bezier(.22,1,.36,1)'});
  }));
  trigger.addEventListener('click',()=>{
    if(mode==='dropoff')state.rally=true;
    if(mode==='sos')state.rescue=true;
    if(mode==='fuel')state.fuel=true;
    if(mode==='offline')state.restored=!state.restored;
    if(mode==='call')state.slow=!state.slow;
    if(mode==='hazard'){
      state.received=0; queuedAlert={ms:0,progress:0};trigger.disabled=true;
      status.textContent='路况已标记 · 等待后车接近 300 m。';
      if(reduced.matches||!playing)stepRelay(1);
      voice.play(sceneMessage());drawRiders();window.KnightVoice.effect('stamp');resume();return;
    }
    updatePanel();
    const line=mode==='dropoff'?crewSpeech.rally:mode==='sos'?crewSpeech.rescue:mode==='fuel'?crewSpeech.fuelMeet:sceneMessage();
    voice.play(line);
    const cue={dropoff:'route',sos:'route',fuel:'route',offline:state.restored?'online':'offline',call:state.slow?'radio':'caution'}[mode];
    if(cue)window.KnightVoice.effect(cue);
  });
  window.__p3reset=()=>{stopVoice();queuedAlert=null;trigger.disabled=false;Object.assign(state,{rally:false,rescue:false,restored:false,fuel:false,slow:false,received:0});updatePanel();};
  find('.p3-broadcast').addEventListener('click',()=>{
    if(mode==='dropoff')state.rally=true;
    if(mode==='fuel')state.fuel=true;
    const line=mode==='call'?crewSpeech.danger:mode==='fuel'?crewSpeech.fuelMeet:mode==='dropoff'?crewSpeech.rally:mode==='sos'?sceneMessage():mode==='hazard'?sceneMessage():crewSpeech.shared;
    voice.play(line);window.KnightVoice.effect('radio');
    updatePanel();status.textContent=mode==='call'?'一键预警「前方危险，减速」已送达 4 台眼镜，以语音播报。':'全队广播已送达 4 台眼镜。'+(mode==='fuel'?'集合地点为镇口加油站。':mode==='dropoff'?'镇口集合路线已同步。':'队友已收到当前事件与坐标。');
  });
  speak.addEventListener('click',announce);
  pause.addEventListener('click',()=>{playing=!playing;if(!playing&&queuedAlert)stepRelay(1);updatePause();resume();});
  reduced.addEventListener('change',()=>{playing=!reduced.matches;if(reduced.matches&&queuedAlert)stepRelay(1);updatePause();resume();});
  window.addEventListener('ride:route',e=>{
    active=e.detail==='p3';
    if(active){resize();resume();}else{stopVoice();stopRun();}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopVoice();stopRun();}else resume();});
  if('ResizeObserver' in window)new ResizeObserver(resize).observe(map);else window.addEventListener('resize',resize);
  updatePanel();updatePause();
})();


  (() => {
    const root = document.querySelector('#assist'); if (!root) return;
    const stage = root.querySelector('#s-stage');
    const alert = root.querySelector('[data-support-alert]');
    const guidance = root.querySelector('[data-support-guidance]');
    const articleTitle = root.querySelector('[data-support-title]');
    const articleList = root.querySelector('[data-support-notes]');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const scenarios = {
      rain: {
        alert: '前方路面湿滑',
        guidance: '留出车距，平缓减速。',
        solo: ['雨天怎么继续骑', ['保持更多跟车空间', '减少急刹与突然变线', '视线受阻时找安全地点停车']],
        tour: ['遇雨如何调整行程', ['视情况增加行程余量', '查看后续路段天气与路况', '选择安全的停车点等待']],
        convoy: ['车队雨天如何协作', ['领队及时播报路况', '扩大队内间距', '约定安全地点重新集合']]
      },
      fatigue: {
        alert: '检测到疲劳迹象',
        guidance: '寻找安全停车点，停下来休息。',
        solo: ['清醒度下降时怎么办', ['停止继续赶路', '找安全地点停车休息', '恢复状态后再决定是否出发']],
        tour: ['给长途行程留休息时间', ['提前标记沿途停靠点', '感到疲劳时缩短当日行程', '必要时安排住宿']],
        convoy: ['队友疲惫时怎么调整', ['告知领队需要休息', '找安全地点统一停靠', '重新安排集合时间']]
      },
      altitude: {
        alert: '高海拔路段 · 骑手报告不适',
        guidance: '安全停车，评估是否需要当地医疗协助。',
        solo: ['高海拔路段出现不适', ['在安全位置停靠', '向同行者或联系人说明情况', '视情况联系当地医疗服务']],
        tour: ['高原行程的准备与求助', ['提前查看沿途补给和救助点', '保留当地求助联系方式', '不适时优先寻求专业意见']],
        convoy: ['发现队友在高原不适', ['确认队友所在位置', '在安全地点汇合', '视情况协助联系当地救援']]
      },
      fall: {
        alert: '检测到疑似摔车',
        guidance: '确认周边安全，必要时联系当地救援。',
        solo: ['事故后如何寻求协助', ['留意车流等现场风险', '把位置和情况告知联系人', '需要时联系当地救援']],
        tour: ['途中出险要报哪些信息', ['确认所在道路和附近地标', '说明现场状况及是否有人受伤', '保留通讯以接收救援指引']],
        convoy: ['收到队友摔车提醒', ['向后方队友转达预警', '在安全地点确认事故位置', '必要时联系当地救援']]
      }
    };

    let scenario = 'rain';
    let profile = 'solo';
    let hasPlayed = false;

    function renderArticle() {
      const [title, notes] = scenarios[scenario][profile];
      articleTitle.textContent = title;
      articleList.replaceChildren(...notes.map(note => {
        const item = document.createElement('li');
        item.textContent = note;
        return item;
      }));
    }

    function replay() {
      hasPlayed = true;
      if (reducedMotion.matches) return;
      stage.classList.remove('is-playing');
      void stage.offsetWidth;
      stage.classList.add('is-playing');
    }

    root.querySelectorAll('[data-support-scenario]').forEach(button => {
      button.addEventListener('click', () => {
        scenario = button.dataset.supportScenario;
        const current = scenarios[scenario];
        stage.dataset.scenario = scenario;
        root.querySelectorAll('[data-support-scenario]').forEach(option => {
          option.setAttribute('aria-pressed', option === button);
        });
        root.querySelectorAll('[data-scene]').forEach(scene => {
          scene.classList.toggle('is-visible', scene.dataset.scene.split(' ').includes(scenario));
        });
        alert.textContent = current.alert;
        guidance.textContent = current.guidance;
        renderArticle();
        replay();
      });
    });

    root.querySelectorAll('[data-support-profile]').forEach(button => {
      button.addEventListener('click', () => {
        profile = button.dataset.supportProfile;
        root.querySelectorAll('[data-support-profile]').forEach(option => {
          option.setAttribute('aria-pressed', option === button);
        });
        stage.classList.remove('is-playing');
        renderArticle();
      });
    });

    root.querySelector('.s-replay').addEventListener('click', replay);

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          if (!hasPlayed) replay();
          observer.disconnect();
        }
      }, { threshold: .35 });
      observer.observe(stage);
    }
  })();


(() => {
  const root = document.getElementById('demo-p4');
  const find = selector => root.querySelector(selector);
  const video = find('video'), still = find('.rec-still'), seek = find('.rec-seek');
  const desk = find('.rec-console'), screen = find('.rec-screen');
  const tabs = [...root.querySelectorAll('[data-rec-tab]')];
  const photos = [null,null,rideMedia.FRAME_CURVE,rideMedia.FRAME_ROUTE];
  const sources = ['领队镜头','中队镜头','收尾镜头','GPS 轨迹'];
  const titles = ['山谷出发','天路十八弯','垭口合影','轨迹收尾'];
  const hud = ['眼镜 01 · 56 km/h · 2,560 m','眼镜 02 · 45 km/h · 4,180 m','眼镜 04 · 0 km/h · 4,298 m','全队 · 318 km · 5 小时 18 分'];
  const locations = ['康定','天路十八弯','折多山垭口','新都桥营地'];
  const heights = ['2,560 m','4,180 m','4,298 m','3,460 m'];
  const albumShot = rideMedia.album, teammateShot = rideMedia.album;
  const shots = [];
  let mode = 'edit', place = 2, otherAngle = false, clip = -1, revision = 0;
  function caption(kicker, title, data) {
    find('.rec-onscreen small').textContent = kicker;
    find('.rec-onscreen strong').textContent = title;
    find('.rec-hud').textContent = data;
  }
  function playbackUI() {
    const t = video.currentTime || 0;
    const index = Math.min(3,Math.floor(t / 15));
    seek.value = String(t);
    find('.rec-time').textContent = (t >= 60 ? '1:00' : '0:' + String(Math.floor(t)).padStart(2,'0')) + ' / 1:00';
    find('[data-rec-play]').textContent = video.paused ? '播放' : '暂停';
    if (mode !== 'edit' || index === clip) return;
    clip = index;
    caption('川西车队 · ' + sources[index],titles[index],hud[index]);
    root.querySelectorAll('[data-cut]').forEach((b,i) => b.setAttribute('aria-pressed',String(i === index)));
  }
  function setTime(value) {
    prepareTeamFilm();
    if (video.readyState >= 1) {
      video.currentTime = value;
      playbackUI();
    } else {
      const intent = ++revision;
      video.addEventListener('loadedmetadata',() => {
        if (intent === revision && mode === 'edit') { video.currentTime = value; playbackUI(); }
      },{once:true});
      if (video.networkState !== 2) video.load();
    }
  }
  function head(label,title) {return '<header><small>'+label+'</small><h2>'+title+'</h2></header>';}
  function pinList() {
    return '<div class="rec-pins" role="group" aria-label="选择路线点位">'+locations.map((name,i)=>
      '<button data-pin="'+i+'" aria-pressed="'+(i===place)+'"><b>'+name+'</b><small>'+heights[i]+'</small></button>').join('')+'</div>';
  }
  function render() {
    video.hidden = mode !== 'edit';
    still.hidden = mode === 'edit';
    find('.rec-transport').hidden = mode !== 'edit';
    tabs.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.recTab===mode)));
    if (mode === 'edit') {
      desk.innerHTML = head('云端剪辑 · 60 秒','全队高光时间线')+'<p>按拍摄时间与定位对齐四路素材，叠加速度、海拔和配乐。</p><div class="rec-tracks" role="group" aria-label="跳到片段">'+titles.map((t,i)=>'<button data-cut="'+i+'"><small>00:'+String(i*15).padStart(2,'0')+'</small><span>'+t+'</span><i style="--start:'+i*25+'%"></i></button>').join('')+'</div><small>点选片段可直接跳看</small>';
      clip = -1; playbackUI(); return;
    }
    if (mode === 'cloud') {
      still.src = photos[3]; still.alt = '川西车队行程路线轨迹图';
      caption('今日路书 · 已同步 4 副眼镜',locations[place],heights[place]+' · 打卡照片已归档');
      desk.innerHTML = head('手机端 · 今日路书','打卡与云端同步')+
        '<div class="rec-facts"><span><b>318 km</b><small>里程</small></span><span><b>5 h 18 m</b><small>骑行时间</small></span><span><b>4 处</b><small>带图打卡</small></span></div>'+pinList()+'<div class="stage-actions"><button data-see-pin>查看此处照片</button><button data-book>导出路书</button></div>';
    } else if (mode === 'snap') {
      still.src = photos[2]; still.alt = '天路十八弯上夜骑的车队';
      caption('眼镜 04 · 语音抓拍','天路十八弯','镜架微镜头 · 4,180 m');
      desk.innerHTML = head('第一视角拍照','“你好骑士，拍一张。”')+
        '<p>语音触发快门，海拔和坐标随照片汇入车队地图相册。</p><div class="rec-facts"><span><b>'+shots.length+' 张</b><small>本次抓拍</small></span><span><b>04</b><small>机位</small></span></div><div class="stage-actions"><button data-snap>说「拍一张」</button><button data-open-shot '+(shots.length?'':'disabled')+'>查看抓拍</button></div><small role="status">'+(shots.length?'最近一张已归入折多山垭口':'等待语音指令')+'</small>';
    } else {
      still.src = otherAngle ? teammateShot : albumShot;
      still.alt = otherAngle ? '队友视角：车队经过山路弯道' : '按地图点位归集的全队相册';
      caption('共享相册 · '+(otherAngle?'队友视角':'主机位'),locations[place],heights[place]+' · '+(otherAngle?'02 号眼镜':'04 号眼镜'));
      desk.innerHTML = head('手机端 · 全队共享','沿路线翻看相册')+pinList()+
        '<small role="status">'+(shots.length && place===2?'包含本次语音抓拍 '+shots.length+' 张':'队友影像按地理点位自动归集')+'</small>';
    }
  }
  const recordVoice=createSceneSpeaker();
  function videoMute(muted) {
    video.muted = muted;
    const b = find('[data-rec-mute]');
    b.textContent = muted ? '取消静音' : '静音';
    b.setAttribute('aria-pressed',String(muted));
  }
  window.addEventListener('knight:quiet-media', () => videoMute(true));
  videoMute(true);
  function switchTab(next) { recordVoice.stop();video.pause(); revision++; mode=next; render(); }
  root.addEventListener('click', event=>{
    const b=event.target.closest('button'); if (!b) return;
    if (b.dataset.recTab) switchTab(b.dataset.recTab);
    if (b.hasAttribute('data-rec-play')) {
      prepareTeamFilm();
      if (video.paused) {
        if (video.ended) video.currentTime=0;
        video.play().catch(() => { if (mode === 'edit') find('.rec-console > small').textContent = '当前浏览器无法播放影片，可点选时间线查看片段。'; });
      } else video.pause();
    }
    if (b.hasAttribute('data-rec-mute')) { videoMute(!window.KnightVoice.audible || !video.muted); }
    if (b.hasAttribute('data-cut')) setTime(Number(b.dataset.cut)*15+.04);
    if (b.hasAttribute('data-pin')) { place=Number(b.dataset.pin); otherAngle=false; render(); desk.querySelector('[data-pin="'+place+'"]').focus({preventScroll:true}); }
    if (b.hasAttribute('data-see-pin') || b.hasAttribute('data-open-shot')) {
      if (b.hasAttribute('data-open-shot')) place=2;
      otherAngle=false; switchTab('album'); tabs[3].focus({preventScroll:true});
    }
    if (b.hasAttribute('data-angle')) { otherAngle=!otherAngle; render(); find('[data-angle]').focus({preventScroll:true}); }
    if (b.hasAttribute('data-snap')) {
      shots.push(2); recordVoice.play("照片已存入车队相册。");window.KnightVoice.effect('shutter');render(); find('[data-snap]').focus({preventScroll:true});
      screen.classList.remove('rec-flash'); void screen.offsetWidth; screen.classList.add('rec-flash');
    }
    if (b.hasAttribute('data-book')) {
      recordVoice.play("今日路书已导出。");window.KnightVoice.effect('sync');
      const book='川西车队路书\n318 km · 5 小时 18 分\n'+locations.map((s,i)=>s+' · '+heights[i]).join('\n');
      const url=URL.createObjectURL(new Blob([book],{type:'text/plain;charset=utf-8'}));
      const a=document.createElement('a'); a.href=url; a.download='川西车队路书.txt'; a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
    }
  });
  seek.addEventListener('input',()=>setTime(Number(seek.value)));
  for (const evt of ['timeupdate','play','pause','seeking','ended']) video.addEventListener(evt,playbackUI);
  window.addEventListener('ride:route',e=>{if(e.detail!=='p4') { revision++; video.pause(); }});
  render();
})();

(() => {
  const pages = [...document.querySelectorAll('[data-page]')];
  const order = pages.map(page => page.dataset.page);
  const links = [...document.querySelectorAll('.site-nav a')];
  const hero = document.querySelector('.hero');
  const subviews = Object.fromEntries(order.map(key => [key,'demo']));
  let active = null;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  function announceView() {
    const context = subviews[active] === 'demo' ? active : active + '-' + subviews[active];
    window.dispatchEvent(new CustomEvent('ride:route', {detail:context}));
  }
  function showSubview(page, name) {
    subviews[page.dataset.page] = name;
    for (const btn of page.querySelectorAll('[data-subview]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.subview === name));
    }
    for (const panel of page.querySelectorAll('[data-pane]')) {
      panel.hidden = panel.dataset.pane !== name;
      if (!panel.hidden) panel.dataset.enter = '';
    }
    announceView();
  }
  function navigate() {
    let route = location.hash.replace(/^#\/?/,'');
    if (route === 'assist') { route = 'p3'; subviews.p3 = 'demo'; }
    if (!order.includes(route)) route = 'home';
    const canonical = '#/' + route;
    if (location.hash !== canonical) {
      try { history.replaceState(null,'',canonical); } catch (_) {}
    }
    const initial = active === null;
    active = route;
    const page = pages.find(p => p.dataset.page === route);
    for (const item of pages) {
      item.hidden = item !== page;
      if (item === page && !initial) item.dataset.enter = '';
      else delete item.dataset.enter;
    }
    if (initial) document.dispatchEvent(new Event('knight:interactive'));
    const navHash = '#/' + ({p3:'p2', p4:'p2'}[route] || route);
    for (const link of links) {
      if (link.hash === navHash) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    }
    if (route === 'home') announceView();
    else showSubview(page,subviews[route]);
    document.title = route === 'home' ? '骑士 Knight｜摩托车 AI 眼镜' : page.querySelector('h1').textContent + '｜骑士 Knight';
    if (!initial) page.querySelector('h1').focus({preventScroll:true});
    document.documentElement.classList.toggle('snap-home', route === 'home');
    window.scrollTo({top:0,behavior:'instant'});
  }
  for (const btn of document.querySelectorAll('[data-subview]')) {
    btn.addEventListener('click',() => showSubview(btn.closest('[data-page]'), btn.dataset.subview));
  }
  const wearImage = hero.querySelector('[data-look-image="wear"]');
  function prepareWear() {
    if (!wearImage.hasAttribute('src')) wearImage.src = rideMedia.wear;
  }
  const wearButton = hero.querySelector('button[data-look="wear"]');
  wearButton.addEventListener('pointerenter', prepareWear, {once:true});
  wearButton.addEventListener('focus', prepareWear, {once:true});
  for (const btn of hero.querySelectorAll('[data-look]')) {
    btn.addEventListener('click',() => {
      if (btn.dataset.look === 'wear') prepareWear();
      hero.dataset.look = btn.dataset.look;
      for (const b of hero.querySelectorAll('button[data-look]')) b.setAttribute('aria-pressed',String(b===btn));
      for (const img of hero.querySelectorAll('[data-look-image]')) img.setAttribute('aria-hidden',String(img.dataset.lookImage!==btn.dataset.look));
    });
  }
  document.addEventListener('keydown',e => {
    if (e.defaultPrevented || e.metaKey || e.altKey || e.ctrlKey || e.shiftKey ||
        e.target.closest('button, input, select, textarea, summary, a, video, [contenteditable=true], [role=tablist]')) return;
    const step = {ArrowLeft:-1, ArrowRight:1}[e.key];
    const next = order[order.indexOf(active) + step];
    if (step && next) { e.preventDefault(); location.hash = '/' + next; }
  });
  window.addEventListener('hashchange',navigate);
  document.addEventListener('visibilitychange',() => {
    if (document.hidden) window.dispatchEvent(new CustomEvent('ride:route',{detail:'background'}));
    else announceView();
  });
  navigate();
})();

(() => {
  const root = document.getElementById('demo-p6');
  if (!root) return;
  const find = s => root.querySelector(s);
  const qa = {
    start: {q:'你好骑士，打不着火怎么办？', a:'摩友们最常用的办法：先看熄火开关和边撑开关，再听启动声判断电瓶。要我一条条说吗？', t:'打不着火 · 先查这三步', c:['确认熄火开关、边撑开关已复位，空挡灯亮起','按启动只听到“咔哒”声，多半是电瓶亏电','电瓶亏电可请队友搭电，或推行至最近维修点'], s:'3 条相似经历 · 川西、滇西'},
    tire: {q:'你好骑士，好像扎胎了怎么办？', a:'先别急着拔钉。打双闪靠边，到安全地点再处理，补好后慢速去补胎点。', t:'半路扎胎 · 安全第一', c:['打双闪减速靠边，在安全地点停车','真空胎可用补胎条临时修补，补后低速行驶','配合胎压传感器观察是否继续漏气'], s:'4 条相似经历 · 参考胎压数据'},
    chain: {q:'你好骑士，链条一直响怎么办？', a:'链条异响多半是缺油或松紧不对。停车后先看链条下垂量，再补链条油。', t:'链条异响 · 先看松紧和润滑', c:['熄火后检查链条下垂量是否在车辆手册范围内','清洁后补链条油，避免沾到刹车盘','异响伴随跳齿，尽快到维修点检查链轮'], s:'2 条骑友经历和 1 条公开案例'},
    altitude: {q:'你好骑士，上了高原车没劲怎么办？', a:'高原空气稀薄，动力下降很常见。放慢节奏、提前降挡爬坡，人和车都别硬撑。', t:'高原车没劲 · 人车都要缓', c:['高海拔动力下降属常见现象，降低预期车速','爬长坡提前降挡，避免高挡拖行','人出现头疼胸闷，先停车休息，必要时下撤'], s:'3 条相似经历 · 当前海拔 4,520 m'},
    rain: {q:'你好骑士，下雨了弯道怎么骑？', a:'入弯前完成减速，压弯角度比平时小，避开井盖和标线。', t:'雨天过弯 · 三个要点', c:['入弯前完成减速，弯中不急刹','压弯角度比平时小，油门柔和','避开井盖、标线和落叶等湿滑点'], s:'3 条领队经验 · 前方有雨'}
  };
  let key = 'start', saved = new Set();
  const kbImg = {start:'knowledge', tire:'kb-tire', chain:'kb-chain', altitude:'kb-altitude', rain:'kb-rain'};
  const kbAlt = {start:'骑手停在山间，镜片前浮现摩友经验卡片', tire:'骑手在路边查看扎胎的后轮', chain:'骑手蹲下检查摩托车链条', altitude:'高原公路上动力不足的摩托车', rain:'雨天山路弯道上的骑手'};
  const answerVoice=createSceneSpeaker(on => {
    const button=find('[data-kb-voice]');
    button.setAttribute('aria-pressed', String(on));
    button.textContent=on?'停止播报':'试听回答';
  });
  function stop(){answerVoice.stop();}
  function render(){
    const d = qa[key];
    root.querySelectorAll('[data-kq]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kq === key)));
    find('[data-kb-ask]').textContent = '“' + d.q + '”';
    const vis = find('.kb-visual'), im = vis && vis.querySelector('img');
    if (im && typeof rideMedia !== 'undefined' && rideMedia[kbImg[key]]) { im.src = rideMedia[kbImg[key]]; im.alt = kbAlt[key]; vis.dataset.kq = key; }
    const ans = find('[data-kb-answer]');
    ans.textContent = d.a; ans.classList.remove('is-new'); void ans.offsetWidth; ans.classList.add('is-new');
    find('[data-kb-title]').textContent = d.t;
    find('[data-kb-cases]').innerHTML = d.c.map(x => '<li>' + x + '</li>').join('');
    find('[data-kb-src]').textContent = d.s;
    const sv = find('[data-kb-save]');
    sv.textContent = saved.has(key) ? '已标记有用' : '这条经验有用';
    find('[data-kb-status]').textContent = '回答仅供参考，以车辆手册和专业维修意见为准。';
  }
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.kq) { stop(); key = b.dataset.kq; render(); return; }
    if (b.hasAttribute('data-kb-voice')) {
      if(answerVoice.active){stop();return;}
      const d=qa[key];
      answerVoice.play(d.a, {explicit:true});
      find('[data-kb-status]').textContent = '播报字幕 · ' + d.a;
    }
    if (b.hasAttribute('data-kb-save')) {
      saved.add(key); render();
      find('[data-kb-status]').textContent = '已记下你的反馈，方便下一位摩友找到这条经验。';
    }
  });
  window.addEventListener('ride:route', e => { if (e.detail !== 'p6') stop(); });
  render();
})();

(() => {
  const root = document.getElementById('flywheel');
  if (!root) return;
  const steps = [
    ['骑行与健康数据','每一次骑行的路线、车速、心率、睡眠和天气，都在帮骑士了解你——你的身体、你的车、你常走的路。'],
    ['更准的个人预警','骑士参考骑行时长、海拔变化和你以往的休息时间，选择提醒的时机。'],
    ['更安心，骑得更多','每次收车都有一份记录，下次出发时能回看上次在哪里休息。'],
    ['分享行程，邀请同骑','把沿途短片和路线做成邀请卡，约朋友下一次一起骑。'],
    ['骑友分享亲历案例','车队越多，路上遇到的问题和解决办法越多，持续汇入骑行知识库。'],
    ['更快找到相似经历','下一位摩友提问时，骑士可以结合车型和路况，找出前人试过的办法。']
  ];
  let i = 0, timer = 0;
  const auto = root.querySelector('[data-fly-auto]');
  function render(){
    root.querySelectorAll('[data-fly]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.fly) === i)));
    root.querySelector('[data-fly-k]').textContent = '第 ' + (i + 1) + ' 环 / 共 6 环';
    root.querySelector('[data-fly-title]').textContent = steps[i][0];
    root.querySelector('[data-fly-text]').textContent = steps[i][1];
  }
  function stop(){ clearInterval(timer); timer = 0; root.classList.remove('is-spinning'); auto.textContent = '依次了解六个环节'; }
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.fly !== undefined) { stop(); i = Number(b.dataset.fly); render(); }
    if (b === auto) {
      if (timer) { stop(); return; }
      root.classList.add('is-spinning'); auto.textContent = '暂停';
      timer = setInterval(() => { i = (i + 1) % steps.length; render(); }, 2200);
    }
  });
  window.addEventListener('ride:route', e => { if (e.detail !== 'p6-fly') stop(); });
  render();
})();

document.addEventListener('click', e => {
  const a = e.target.closest('[data-scroll]');
  if (!a) return;
  e.preventDefault();
  const target = document.getElementById(a.dataset.scroll);
  if (target) target.scrollIntoView({behavior: 'smooth', block: 'start'});
});

window.KNIGHT_EN = {"# / # 人已入队": "# / # joined", "# / # 人已入队 · 眼镜播报：“我 已加入”": "# / # joined · Glasses: \"I'm in\"", "# / # 台在线": "# / # online", "# / # 座 · 云端骑士徽章待解锁": "# / # · cloud Knight badge to unlock", "# / # 座垭口": "# / # passes", "# m · # 号眼镜": "# m · Glasses #", "# m · 同向": "# m · same direction", "# m · 打卡照片已归档": "# m · check-in photo saved", "# m 以上车没劲、怠速不稳": "Above # m: weak power, rough idle", "# m，和老王在经幡下合影": "# m, photo with Lao Wang under the prayer flags", "# · # km · 建议补给": "# · # km · refuel advised", "# · # km · 负荷平稳": "# · # km · steady load", "# · 小北": "# · Xiao Bei", "# · 康定": "# · Kangding", "# · 愿景": "# · Vision", "# · 我": "# · Me", "# · 折多山垭口": "# · Zheduo Pass", "# · 收尾": "# · Finish", "# · 新都桥": "# · Xinduqiao", "# · 痛点": "# · Pain points", "# · 营地": "# · Camp", "# · 解决方案": "# · Solution", "# · 领队": "# · Leader", "# 位摩友补充了骑法与注意事项": "# riders added riding tips and cautions", "# 全程": "# full route", "# 台眼镜": "# glasses", "# 号 · 约 # m": "No. # · ~# m", "# 号 · 领队": "No. # · Leader", "# 号车发出 SOS": "Bike # sent SOS", "# 号车坐标与事件已同步至全队镜片。": "Bike #'s location and event synced to every lens.", "# 号车掉队": "Bike # fell behind", "# 号车油量剩余 #%": "Bike # fuel left #%", "# 号车落后 # km": "Bike # is # km behind", "# 处": "# spots", "# 张": "# photos", "# 段": "# clips", "# 求援 · # 最近": "# help call · # nearest", "# 秒": "# s", "# 秒内可选择“我已安全”取消求助。": "Tap \"I'm safe\" within # s to cancel.", "AI 挑选高光": "AI picks highlights", "AI 补给建议": "AI refuel advice", "AI 语音对话 · 代收消息 · 识图": "AI voice chat · messages · vision", "AI 随行": "AI Companion", "AI 随行展示方式": "AI Companion views", "AI 随行｜骑士 Knight": "AI Companion | Knight", "App + 眼镜语音同步": "App + glasses voice sync", "App 拉群组队": "Group up in the App", "App 拉群组队，位置、排名、赛况同步到眼镜。": "Group up in the App; positions, ranks and race status sync to the glasses.", "App 组队": "App groups", "App 里摩友发帖，加上网络公开的骑行问题与解决案例": "Rider posts in the App, plus public riding problems and fixes online", "G# · 折多塘东": "G# · East Zheduotang", "G# 车队位置模拟": "G# crew positions", "HUD 导航与音乐": "HUD navigation & music", "P#P 离线直连": "P#P offline link", "Vlog + 手帐": "Vlog + journal", "“你好骑士”": "\"Hey Knight\"", "“你好骑士，上了高原车没劲怎么办？”": "\"Hey Knight, the bike feels weak at altitude. What now?\"", "“你好骑士，下雨了弯道怎么骑？”": "\"Hey Knight, how do I corner in the rain?\"", "“你好骑士，前面那座塔是什么？”": "\"Hey Knight, what's that tower ahead?\"", "“你好骑士，回复老王「二十分钟到」”": "\"Hey Knight, reply to Lao Wang: '20 minutes away'\"", "“你好骑士，好像扎胎了怎么办？”": "\"Hey Knight, I think I have a flat. What now?\"", "“你好骑士，打不着火怎么办？”": "\"Hey Knight, the bike won't start. What now?\"", "“你好骑士，拍一张”": "\"Hey Knight, take a photo\"", "“你好骑士，拍一张。”": "\"Hey Knight, take a photo.\"", "“你好骑士，接听”": "\"Hey Knight, answer\"", "“你好骑士，最近的加油站在哪？”": "\"Hey Knight, where's the nearest gas station?\"", "“你好骑士，跟前面车队打个招呼。”": "\"Hey Knight, say hi to the crew ahead.\"", "“你好骑士，链条一直响怎么办？”": "\"Hey Knight, my chain keeps rattling. What now?\"", "“老王：到哪了？垭口等你”": "\"Lao Wang: Where are you? Waiting at the pass\"", "「二十分钟到」已发送给老王，双手不离把。": "\"20 minutes away\" sent to Lao Wang, hands still on the bars.", "「你好骑士，邀请老王组队」": "\"Hey Knight, invite Lao Wang to ride\"", "「双手留给车把，眼睛留给风景，其余的交给骑士。」": "\"Hands for the bars, eyes for the view. Leave the rest to Knight.\"", "一个 App": "One App", "一个社区": "One community", "一副戴进头盔的 AI 眼镜 + 一个 App + 一个摩友社区。": "AI glasses that fit in your helmet + an App + a rider community.", "一副眼镜": "One pair of glasses", "一副眼镜 + 一个 App + 一个社区": "Glasses + App + Community", "一句话提问": "Ask in one sentence", "一句话，召回摩友的解决办法 →": "One sentence recalls how other riders solved it →", "一起记录": "Ride Records", "一键拉群": "One-tap group", "一键拉群，实时位置与排名": "One-tap group, live positions & ranks", "一键拉群，或说一句就邀请": "One tap, or one sentence, to invite", "一键预警": "One-tap alert", "下一位摩友问同样的问题，骑士回答得更快、更准——回到第一环，飞轮继续转。": "Next time a rider asks the same, Knight answers faster and better. Back to step one; the flywheel keeps turning.", "不用按，旅途自己会留下": "No buttons. The journey records itself", "两处海拔超过四千米的垭口示意剖面": "Elevation profile with two passes above 4,000 m", "个人功能 · 安全预警": "Personal · Safety alerts", "个人功能 · 随行伙伴": "Personal · Ride companion", "个人守护": "Personal Guard", "个人守护展示方式": "Personal Guard views", "个人守护｜骑士 Knight": "Personal Guard | Knight", "个人骑行": "Solo riding", "个性化路线推荐": "Personalized route picks", "中": "中", "为什么是我们": "Why us", "为什么是摩友": "Why riders", "为热爱买单": "Paying for passion", "云端 AI 成片": "Cloud AI film", "云端剪辑 · # 秒": "Cloud edit · # s", "云端补传": "Cloud backfill", "五台摩托车编队骑行的航拍画面": "Aerial shot of five motorcycles riding in formation", "产品外观": "Product", "人出现头疼胸闷，先停车休息，必要时下撤": "Headache or chest tightness: stop, rest, descend if needed", "今日 # km，心情：值了": "# km today. Mood: worth it", "今日 Vlog 已生成": "Today's Vlog is ready", "今日垭口挑战": "Today's pass challenge", "今日手帐": "Today's journal", "今日手帐已按时间与地点自动排好。": "Today's journal is laid out by time and place.", "今日爬升王": "Top climber today", "今日路书 · 已同步 # 副眼镜": "Today's roadbook · synced to # glasses", "今日路线任务 · 全队打卡两座海拔 # 米以上的垭口。": "Today's task · whole crew checks in at two passes above # m.", "今日车队荣誉": "Today's crew honors", "今日里程": "Distance today", "今日高光 · 片段三": "Today's highlight · clip 3", "今日高光 · 片段二": "Today's highlight · clip 2", "今日高光榜已出现在模拟车队群。": "Today's highlights posted to the crew group.", "从「提醒你」到「更懂你的身体和你的车」。": "From \"alerting you\" to \"knowing your body and your bike\".", "从一副眼镜，到摩友的安全网络和骑行社区。": "From one pair of glasses to a rider safety network and community.", "从车队互助，到更大范围的骑行安全网络。": "From crew mutual aid to a wider riding safety network.", "代收消息 · AI 对话": "Messages · AI chat", "代收电话微信、AI 对话、自动记录": "Calls & WeChat, AI chat, auto-recording", "以对讲为主": "Mostly intercom", "位置": "Location", "位置共享 · 待全员入队（# / #）": "Location sharing · waiting for all (# / #)", "低头一瞬尾灯已亮，慢漏气骑着也感觉不到。": "Brake lights flash while you glance down; slow leaks go unnoticed.", "你已到达高海拔路段，心率偏高，放慢节奏，记得补水。": "You've reached high altitude and your heart rate is up. Slow down and drink water.", "你的反馈已回流社区知识库：下一位遇到同样问题的摩友，会更快听到这条答案。": "Your feedback is back in the community knowledge base: the next rider with this problem hears the answer faster.", "保持联络": "Stay connected", "停止播报": "Stop", "停车掏手机不现实，重要消息一路漏掉。": "Stopping for the phone isn't realistic; key messages get missed.", "停车掏手机拍，回家素材没人剪。": "Stop to shoot on the phone; nobody edits the footage at home.", "停靠后告知联系人当前状况。": "After stopping, tell your contacts how you are.", "先别急着拔钉。打双闪靠边，到安全地点再处理，补好后慢速去补胎点。": "Don't pull the nail yet. Hazards on, pull over, fix it somewhere safe, then ride slowly to a tire shop.", "入弯前完成减速，压弯角度比平时小，避开井盖和标线。": "Brake before the corner, lean less than usual, avoid manholes and road paint.", "入弯前完成减速，弯中不急刹": "Finish braking before the corner; no hard braking mid-turn", "入队后位置与排名实时共享": "Positions and ranks shared live after joining", "全程压队，零掉队": "Sweep the whole way, nobody left behind", "全程语音，双手不离把。信息同步到眼镜，以语音播报为主。": "All voice, hands on the bars. Info syncs to the glasses, mostly as voice prompts.", "全队地图相册": "Crew map album", "全队实时位置，语音播报掉队与危险 →": "Live crew positions; voice alerts for stragglers and hazards →", "全队广播": "Crew broadcast", "全队广播已送达 # 台眼镜。集合地点为镇口加油站。": "Broadcast delivered to # glasses. Meet at the gas station at the town entrance.", "全队镜片标出掉队车辆的方位，并提醒领队。": "Every lens marks the straggler's direction and alerts the leader.", "全队高光时间线": "Crew highlight timeline", "共享中": "Sharing", "共享相册 · 主机位": "Shared album · main camera", "关键里程碑": "Key milestones", "分享并邀请同骑": "Share & invite riders", "分享组队，带来新摩友": "Share rides, bring new riders", "分享至模拟车队群": "Share to crew group", "刚需": "Must-have", "刹车灯提示 · 注意车距": "Brake light · keep your distance", "刹车灯识别 + 测距 + 车速": "Brake-light detection + ranging + speed", "刹车灯识别 + 测距 + 车速预警，胎压胎温实时监测 →": "Brake-light detection, ranging and speed alerts; live tire pressure & temp →", "前方 # km 镇口有加油站，路线已投到镜片上。": "Gas station at the town entrance # km ahead; route is on your lens.", "前方发现川西车队": "Sichuan crew spotted ahead", "前方有阵雨，弯道路面可能湿滑。": "Showers ahead; corners may be slippery.", "前方连续右弯，音乐自动降低。": "Right-hand curves ahead; music lowered.", "前方阵雨": "Showers ahead", "前方降雨趋势": "Rain ahead trend", "前车刹车灯亮起的第一视角与镜片预警示意": "First-person view of lit brake lights ahead with a lens warning", "前车急刹": "Car ahead braking", "前车急刹、胎压异常，都来不及反应": "Sudden braking ahead, tire trouble: no time to react", "前车急刹测距": "Brake-ahead ranging", "前车距离缩短，请拉开车距。": "Gap closing. Back off.", "前车距离趋势": "Gap to vehicle ahead", "前车跟踪": "Tracking vehicle ahead", "前车追尾预警": "Rear-end warning", "前轮": "Front", "剩余": "Remaining", "功能演示": "Demo", "匹配社区相似案例": "Match similar community cases", "半路扎胎": "Flat tire", "半路扎胎 · 安全第一": "Flat tire · safety first", "危险，先你一步看见：前车、轮胎、身体，一副眼镜替你盯着。": "See danger first: the car ahead, your tires, your body. The glasses watch for you.", "压弯、落日、队友回头比的手势，都被自动打标；收车后汇成短片和一页手帐。": "Leaning into curves, sunsets, a teammate's wave: all auto-tagged, then cut into a short film and a journal page.", "压弯角度比平时小，油门柔和": "Lean less than usual; smooth throttle", "双手不离把，说话就能问、能拍、能录，旅途自己会留下。": "Hands on the bars. Talk to ask, shoot and record; the trip records itself.", "双手离不开车把，电话微信没法回": "Hands on the bars, can't answer calls or WeChat", "双手被车把占用、风险高，免手持的价值比日常场景大得多。": "Hands busy, risk high: hands-free matters far more than in daily life.", "发起加油集结": "Call a refuel stop", "召回": "Recall", "召回 # 条摩友案例 + # 条网络公开经验": "# rider cases + # public tips recalled", "召回 # 条相似摩友案例 · 川西、滇西": "# similar rider cases · W. Sichuan, W. Yunnan", "召回 # 条相似摩友案例 · 结合当前海拔 # m": "# similar cases · at current altitude # m", "召回 # 条相似摩友案例 · 胎压数据已关联": "# similar cases · tire data linked", "召回 # 条领队经验 · 结合前方降雨": "# leader tips · rain ahead factored in", "召回更快更准": "Faster, sharper answers", "同路两支车队通过眼镜语音互致问候": "Two crews greet each other by voice through the glasses", "同路语音致意": "Voice greetings", "同路雷达": "Route radar", "同路雷达识别到前方 # 米的同向车队，语音唤醒即可互致问候。": "Radar found a crew # m ahead, same direction. Wake word to say hi.", "后车提前 # m 收到提醒": "Riders behind warned # m early", "后轮": "Rear", "后轮 # bar，胎温 #°C 仍在上升。": "Rear # bar, tire temp #°C and rising.", "后轮胎压下降": "Rear tire pressure dropping", "后轮胎压偏低，建议在下个服务区停车检查。": "Rear tire pressure low. Check it at the next rest stop.", "后轮胎压趋势": "Rear tire pressure trend", "向后方预警，核对事故位置。": "Warn riders behind; confirm the crash location.", "听懂 · 看懂": "Hears · Sees", "四台眼镜切入 P#P 直连，位置和告警逐车接力。": "Four glasses switch to P#P; positions and alerts relay bike to bike.", "四大功能": "Four pillars", "回答仅供参考，以车辆手册和专业维修意见为准。": "For reference only. Follow your manual and a professional mechanic.", "团队与进展": "Team & progress", "圈层强": "Tight-knit", "场景深度": "Scenario depth", "场景示意": "Scene", "垭口合影": "Pass group photo", "垭口打卡": "Pass check-in", "垭口日落": "Pass sunset", "城市夜骑的骑手，镜片内显示转向与音乐": "Night city rider; turn arrows and music in the lens", "壁垒": "Moat", "多机位自动成片、云端路书与地图相册。": "Multi-camera auto films, cloud roadbook and map album.", "大车淋水": "Truck spray", "天气": "Weather", "天气与道路环境": "Weather & road conditions", "天气路况": "Weather & roads", "天然组队、爱分享、爱装备，口碑与车队带来裂变。": "Riders group up, share and love gear; word of mouth and crews drive growth.", "天路十八弯": "18 Bends of the Sky Road", "天路十八弯上夜骑的车队": "Crew riding the 18 Bends at night", "头盔内佩戴": "In-helmet fit", "头盔蓝牙耳机": "Helmet Bluetooth headset", "妈妈来电已接通，风噪过滤开启；说「挂断」即可拒接。": "Mom's call connected, wind noise filtered. Say \"hang up\" to decline.", "始终可用": "Always on", "守护每一位骑手": "Protect every rider", "安全互助": "Crew Safety", "安全预警场景": "Safety alert scenarios", "定位对比（示意，以团队竞品调研为准）": "Positioning (illustrative; per team's competitor research)", "实时位置与排名": "Live positions & ranks", "对个人：懂我　·　对摩友群体：懂骑行": "For you: knows you · For riders: knows riding", "对照油量、续航与体能负荷，选择前方顺路的补给点。": "Weigh fuel, range and fatigue; pick a refuel stop on the way.", "导出路书": "Export roadbook", "导航提示结束后，音乐恢复原音量。": "Navigation done; music back to full volume.", "导航播报": "Nav prompts", "导航播报时自动压低，播报结束恢复": "Ducks during nav prompts, then restores", "封闭路段演示": "Closed-road demo", "将事件与坐标发给全队，为最近的 # 号车规划返回路线。": "Send event and location to the crew; route bike # back.", "小": "Small", "小林": "Xiao Lin", "山海挑战": "Mountain & Sea Challenge", "山谷出发": "Valley start", "山谷晨雾": "Valley mist", "山路弯多、信号差，喊也喊不应。": "Winding roads, weak signal; shouting doesn't help.", "山路弯道": "Mountain curves", "川西 # 小队": "W. Sichuan crew #", "川西 # 小队 · 邀请码 KN#": "W. Sichuan crew # · code KN#", "川西 · 已解决": "W. Sichuan · Solved", "川西 · 折多山": "W. Sichuan · Zheduo", "川西三站": "Three stops in W. Sichuan", "川西车队 # 秒配乐影像演示": "W. Sichuan crew · #-s film demo with music", "川西车队 · # 台车": "W. Sichuan crew · # bikes", "川西车队 · 本队": "W. Sichuan crew · us", "川西车队 · 领队镜头": "W. Sichuan crew · leader cam", "川西车队行程路线轨迹图": "W. Sichuan crew route map", "已保存第一视角超车片段": "First-person overtaking clip saved", "已入队": "Joined", "已分享至模拟车队群": "Shared to crew group", "已发送给老王": "Sent to Lao Wang", "已回流 · 谢谢反馈": "Shared back · thanks", "已找到前方 # km 镇口加油站，可向全队发送集结广播。": "Gas station # km ahead at the town entrance; broadcast a meetup to the crew.", "已拍摄，照片附带坐标与海拔，归入今日生活库。": "Photo taken with coordinates and altitude, filed in today's library.", "已经连续骑行很久了，前方有休息区，歇一会儿再走。": "You've been riding a long time. Rest area ahead; take a break.", "已限制": "Limited", "带图打卡": "Photo check-in", "常见骑行问题": "Common riding problems", "年度 # km": "# km this year", "年度骑行手帐": "Annual ride journal", "应急经验库": "Emergency know-how", "应答窗口": "Response window", "康定": "Kangding", "康定 → 折多山 → 新都桥": "Kangding → Zheduo Pass → Xinduqiao", "康定 ✓": "Kangding ✓", "康定市区 · # m": "Kangding city · # m", "康定经折多山到新都桥的海拔剖面": "Elevation profile Kangding–Zheduo Pass–Xinduqiao", "开启": "On", "异响伴随跳齿，尽快到维修点检查链轮": "Rattle plus skipping teeth: check the sprockets at a shop soon", "弯道路面可能湿滑。": "Corners may be slippery.", "当前车速": "Speed", "当前速度": "Speed", "录像": "Videos", "待机": "Standby", "微信 · 老王 · 语音读出": "WeChat · Lao Wang · read aloud", "微信播报": "WeChat read-out", "心率": "Heart rate", "心率偏高、昨晚睡眠不足；你在车队群说“有点困”。": "High heart rate, short sleep last night; you said \"a bit sleepy\" in the crew chat.", "愿景与融资": "Vision & funding", "成就": "Badges", "成片预览": "Film preview", "我": "Me", "我 · # 号": "Me · No. #", "我已安全": "I'm safe", "手机 App 一键拉群，或对眼镜说一句远程发起邀请。": "One tap in the phone App, or one sentence to the glasses, to invite remotely.", "手机 App 拉群界面": "Phone App group screen", "手机上自动生成的骑行 Vlog 与手帐": "Ride Vlog and journal auto-generated on the phone", "手机健康数据（心率、睡眠）+ 天气 + 海拔，综合提醒 →": "Phone health data (heart rate, sleep) + weather + altitude, combined alerts →", "手机端 · 今日路书": "Phone · today's roadbook", "手机端 · 全队共享": "Phone · crew shared", "手机端 · 拉群": "Phone · group", "打不着火": "Won't start", "打不着火 · 先查这三步": "Won't start · check these three", "打卡 · 成就 · 邀请": "Check-ins · badges · invites", "打卡与云端同步": "Check-in & cloud sync", "打卡成就、vlog 与手帐": "Check-ins, badges, vlog & journal", "打卡第二座垭口": "Check in at the second pass", "打双闪减速靠边，在安全地点停车": "Hazards on, slow down, stop somewhere safe", "找安全地点停车休息。": "Find a safe place to stop and rest.", "把全年的打卡、照片和里程装订成一本手帐。": "Bind a year of check-ins, photos and miles into one journal.", "抓拍": "Snap", "折多山": "Zheduo Pass", "折多山垭口": "Zheduo Pass summit", "折多山垭口 · # m": "Zheduo Pass · # m", "拍一张": "Take a photo", "拍摄为主": "Mostly filming", "按你的骑行习惯、车型和天气推荐周末路线。": "Weekend routes picked for your habits, bike and weather.", "按启动只听到“咔哒”声，多半是电瓶亏电": "Only a \"click\" when you press start: probably a weak battery", "按品牌和车型沉淀故障与保养经验。": "Fault and maintenance know-how by brand and model.", "按地图点位归集的全队相册": "Crew album organized by map location", "按拍摄时间与定位对齐四路素材，叠加速度、海拔和配乐。": "Four feeds aligned by time and GPS, with speed, altitude and music overlaid.", "挑战指标": "Challenge metrics", "换掉眼镜，意味着丢掉车队、记录和成就。": "Switching glasses means losing your crew, records and badges.", "掉队失联，一回头人没了": "Fall behind, and the crew is gone", "掉队预警": "Straggler alert", "接听来电": "Answer call", "摔车": "Crash", "摔车求助": "Crash SOS", "摩友互助地图": "Rider help map", "摩友们最常用的办法：先看熄火开关和边撑开关，再听启动声判断电瓶。要我一条条说吗？": "Riders' go-to fix: check the kill switch and side-stand switch, then listen to the starter to judge the battery. Want it step by step?", "摩友在车和装备上的投入高；客单价与人群规模": "Riders spend heavily on bikes and gear; spend per rider and market size", "摩友社区知识库": "Rider knowledge base", "摩友经验，就在耳边；越用越懂你。": "Rider know-how, right in your ear; gets to know you over time.", "播报字幕 · 二号车油量百分之十八，建议在前方十二公里的镇口加油站集结。": "Caption · Bike 2 fuel at 18%. Regroup at the gas station 12 km ahead.", "播报字幕 · 先别急着拔钉。打双闪靠边，到安全地点再处理，补好后慢速去补胎点。": "Caption · Don't pull the nail yet. Hazards on, pull over, fix it somewhere safe, then ride slowly to a tire shop.", "播报字幕 · 入弯前完成减速，压弯角度比平时小，避开井盖和标线。": "Caption · Brake before the corner, lean less than usual, avoid manholes and road paint.", "播报字幕 · 摩友们最常用的办法：先看熄火开关和边撑开关，再听启动声判断电瓶。要我一条条说吗？": "Caption · Riders' go-to fix: check the kill switch and side-stand switch, then listen to the starter to judge the battery. Want it step by step?", "播报字幕 · 链条异响多半是缺油或松紧不对。停车后先看链条下垂量，再补链条油。": "Caption · Chain noise usually means dry or wrong tension. Check the slack, then lube it.", "播报字幕 · 高原空气稀薄，动力下降很常见。放慢节奏、提前降挡爬坡，人和车都别硬撑。": "Caption · Thin air at altitude cuts power. Slow down, downshift early on climbs; don't push you or the bike.", "播放": "Play", "播放短片": "Play film", "播放音乐": "Play music", "收起手帐": "Hide journal", "收车 · 今日结算": "Day's wrap-up", "收车后在高原湖边击掌庆祝的车队": "Crew celebrating with high-fives by a highland lake", "数据与知识库": "Data & knowledge base", "数据来源 · 前车刹车灯识别 · 视觉测距 · 本车车速": "Source · brake-light detection · visual ranging · own speed", "数据来源 · 姿态突变检测 · 定位 · 紧急联系人": "Source · sudden motion detection · location · emergency contacts", "数据来源 · 实时天气 · 路线前方降雨与气温": "Source · live weather · rain and temperature ahead", "数据来源 · 手机健康数据 · App 车队聊天 · 骑行时长 · 天气": "Source · phone health data · App crew chat · ride time · weather", "数据来源 · 海拔与天气 · 手机健康数据（血氧 / 心率）· 车队群聊天": "Source · altitude & weather · phone health (SpO2 / HR) · crew chat", "数据来源 · 胎压胎温传感器（气门嘴小硬件）· 实时连接眼镜": "Source · tire sensor (valve-cap device) · live link to glasses", "数据飞轮六个环节": "Six steps of the data flywheel", "整理成骑行知识库，按车型、路况、地区归类": "Organized into a riding knowledge base by bike, road and region", "整理自公开骑行经验，已标注车型": "From public riding know-how, tagged by model", "新都桥": "Xinduqiao", "新都桥 · 已同步照片、海拔与坐标。": "Xinduqiao · photo, altitude and coordinates synced.", "新都桥 ✓": "Xinduqiao ✓", "新都桥营地": "Xinduqiao camp", "新都桥镇 · # m": "Xinduqiao town · # m", "旅途歌单 · 已暂停": "Road playlist · paused", "旅途歌单 · 播放中": "Road playlist · playing", "无信号": "No signal", "无信号直连": "Offline link", "无需额外设备：手机 + 眼镜即可": "No extra devices: phone + glasses", "昨晚睡眠": "Sleep last night", "晨雾里出发，气温 #°C": "Set off in morning mist, #°C", "暂停": "Pause", "暂停短片": "Pause film", "暂停队形": "Pause formation", "暂停音乐": "Pause music", "暂存 # 条报文": "# messages queued", "暗冰积水": "Black ice / puddles", "更准的个人预警": "Sharper personal alerts", "更安心，骑得更多": "More peace of mind, more riding", "替你看路、连起车队、记下每一程。": "Watches the road, links your crew, records every ride.", "最佳第一视角": "Best POV shot", "最稳护航官": "Steadiest escort", "最近队友": "Nearest teammate", "最近队友协助": "Nearest teammate helps", "服务区一碗热面，歇了 # 分钟": "Hot noodles at the rest stop, # min break", "本次抓拍": "This snap", "本轮融资金额": "Raise amount", "机位": "Camera", "来电 · 妈妈 · 已接通": "Call · Mom · connected", "查看后续路况并预留时间。": "Check the road ahead and allow extra time.", "查看打卡记录": "View check-ins", "查看抓拍": "View snap", "查看此处照片": "Photos here", "查看返回路线": "View return route", "查看附近补给与医疗协助点。": "See nearby supplies and medical help.", "标出靠谱的修车点、补给点和摩友驿站。": "Mark trusted repair shops, supply points and rider stops.", "标记人": "Tagged", "样机与种子用户进展": "Prototype & seed user progress", "模块化头盔内的骑士眼镜佩戴效果": "Knight glasses worn inside a modular helmet", "模拟减速到 # km/h": "Slow to # km/h", "模拟弯道播报": "Play curve prompt", "模拟录像": "Record", "模拟恢复信号": "Restore signal", "模拟摔车": "Simulate crash", "模拟暗号组队": "Join by code", "模拟语音打卡": "Voice check-in", "模拟语音抓拍": "Voice snap", "模拟语音标险": "Voice hazard mark", "模拟语音致意": "Send voice greeting", "模拟超车抓拍": "Overtake snap", "模拟队友加入": "Teammate joins", "每一公里，都算数": "Every kilometer counts", "每一次骑行的路线、车速、心率、睡眠和天气，都在帮骑士了解你——你的身体、你的车、你常走的路。": "Every ride's route, speed, heart rate, sleep and weather help Knight learn you: your body, your bike, your usual roads.", "每一程，": "Every ride,", "每一程，都值得被好好讲出来。": "Every ride deserves to be told well.", "求助对象": "Notify", "求援位置": "Help location", "汇集": "Collect", "汇集摩友骑行问题与解法": "Riders' problems and fixes, collected", "沉淀": "Distill", "油量与集结": "Fuel & regroup", "沿路线翻看相册": "Browse album along the route", "沿途地标已识别，简介与照片存入今日生活库。": "Landmark recognized; info and photo saved to today's library.", "沿途收集": "Collected", "沿途讲解模式": "Roadside guide mode", "海拔": "Altitude", "海拔 # m，血氧 #%；你在群里提到“头有点疼”。": "Altitude # m, SpO2 #%; you said \"a bit of a headache\" in chat.", "深泥": "Deep mud", "清洁后补链条油，避免沾到刹车盘": "Clean, then lube; keep it off the brake disc", "湿滑": "Slippery", "滇藏车队": "Yunnan–Tibet crew", "滇西 · 已解决": "W. Yunnan · Solved", "滨江夜骑路线 · 剩余 # km": "Riverside night ride · # km left", "点选片段可直接跳看": "Tap a clip to jump to it", "照片已归入今日生活库。": "Photo saved to today's library.", "熄火后检查链条下垂量是否在车辆手册范围内": "With the engine off, check chain slack against the manual", "爆胎": "Blowout", "爬长坡提前降挡，避免高挡拖行": "Downshift early on long climbs; don't lug in high gear", "生成今日手帐": "Make today's journal", "用户留存": "Retention", "电瓶亏电可请队友搭电，或推行至最近维修点": "Weak battery: jump-start from a teammate or push to the nearest shop", "电话微信，不用掏手机": "Calls & WeChat, no phone needed", "留足跟车空间。": "Leave plenty of following distance.", "疑似摔车": "Possible crash", "疑似摔车与求助": "Possible crash & SOS", "疑似摔车后的求助倒计时示意": "SOS countdown after a possible crash", "疲劳监测": "Fatigue", "直接看演示": "See the demo", "看和说": "See & speak", "真空胎可用补胎条临时修补，补后低速行驶": "Tubeless: plug it temporarily, then ride slowly", "眼镜 # · # km/h · # m": "Glasses # · # km/h · # m", "眼镜 # · 语音抓拍": "Glasses # · voice snap", "眼镜、骑手与车队首尾相连的发光飞轮": "Glowing flywheel linking glasses, riders and crews", "眼镜代收发电话、微信，团队语音、播报提醒与音乐 →": "Glasses handle calls & WeChat, crew voice, alerts and music →", "眼镜视角": "Glasses view", "眼镜视角：骑手对眼镜说话发起组队邀请": "Glasses view: rider speaks to send a group invite", "眼镜语音播报：“当前排名第二，距领队 # 公里。”": "Glasses: \"You're 2nd, # km behind the leader.\"", "知识召回": "Ask the Community", "石墨色骑士 Knight AI 眼镜，镜片内显示 HUD": "Graphite Knight AI glasses with HUD in the lens", "硬件视图": "Hardware view", "确认周边安全，按需联系当地救援。": "Make sure the area is safe; call local rescue if needed.", "确认熄火开关、边撑开关已复位，空挡灯亮起": "Kill switch and side-stand switch reset, neutral light on", "确认现场安全，联系当地救援。": "Secure the scene, call local rescue.", "确认队友位置，按需协助联系救援。": "Locate teammates; help call rescue if needed.", "碎石": "Gravel", "社区 · 经验 · 飞轮": "Community · Know-how · Flywheel", "社区帖子示例": "Community post examples", "社区案例量": "Community cases", "社区沉淀": "From the Community", "社区沉淀真实案例": "Real cases from the community", "离线知识包": "Offline pack", "第 # 环 / 共 # 环": "Step # / #", "第一步": "Step 1", "第一视角录像示意": "First-person recording", "第一视角拍照": "First-person photo", "第三步": "Step 3", "第二步": "Step 2", "等待语音指令": "Waiting for voice command", "等待骑手应答，# 秒后模拟发出求助。": "Waiting for rider; SOS sends in # s.", "等待骑手确认": "Waiting for rider to confirm", "累计爬升": "Total climb", "累计爬升 # m": "Total climb # m", "累计里程": "Total distance", "组队和沉淀": "Group & share", "组队娱乐": "Ride Together", "组队邀请": "Group invite", "经过地标、古镇时，自动讲一段背后的故事。": "Passing landmarks and old towns, it tells the story behind them.", "经过地标自动识别，打卡照片附带坐标与海拔。": "Landmarks recognized; check-in photos tagged with coordinates and altitude.", "经验": "Know-how", "经验贡献激励": "Contributor rewards", "结合你的车和路况讲给你听": "Tailored to your bike and road", "结束录像": "Stop recording", "继续队形": "Resume formation", "编队 HUD": "Formation HUD", "编队中": "In formation", "编队顺序与距领队距离": "Order and gap to leader", "网络效应": "Network effects", "网络案例 · 已收录": "Web case · Indexed", "老": "L", "老周": "Lao Zhou", "老周 · # 号": "Lao Zhou · No. #", "老周 · # 号 ↗": "Lao Zhou · No. # ↗", "老周 · 最佳第一视角": "Lao Zhou · Best POV shot", "老王 · # 号": "Lao Wang · No. #", "老王 · # 号 ↗": "Lao Wang · No. # ↗", "老王 · 今日爬升王": "Lao Wang · Top climber", "老王 · 领队": "Lao Wang · Leader", "老王发来微信，眼镜已语音读出。想回复，只需说一句。": "WeChat from Lao Wang, read aloud by the glasses. To reply, just say it.", "耳边回答 + 镜片回执": "Answer in your ear + lens receipt", "联动传感器与健康数据": "Sensors + health data combined", "联系方式": "Contact", "胎压、胎温与保养记录汇成你的爱车档案。": "Tire pressure, temperature and service history become your bike's file.", "胎压与胎温": "Tire pressure & temp", "胎压胎温": "Tire pressure", "胎压胎温 / 健康 / 高反": "Tires / health / altitude", "自动 Vlog 与手帐": "Auto Vlog & journal", "自动 vlog / 手帐 / 成就": "Auto vlog / journal / badges", "自动生成的 vlog、成就和邀请卡被分享出去，一个人带来一整支车队。": "Auto vlogs, badges and invite cards get shared; one rider brings a whole crew.", "自动记录": "Auto record", "自动记录 · AI 整理成片与手帐": "Auto record · AI film & journal", "自动记录 · 今日高光": "Auto record · today's highlights", "自动记录，到家就有 vlog 和手帐 →": "Auto-recorded; a vlog and journal waiting when you get home →", "自动转为播报": "Auto read-out", "自动转动飞轮": "Auto-spin flywheel", "自由通话": "Free talk", "荣誉榜单": "Honor board", "营地里那句「我也遇到过」，以后在路上也听得到。": "The campfire \"me too\" you hear, now on the road as well.", "落后领队 # km": "# km behind leader", "落石": "Rockfall", "蜂窝信号 # 格": "Cell signal # bars", "蜂窝网络": "Cellular", "血氧": "SpO2", "血氧变化趋势": "SpO2 trend", "被采纳的解决方案点亮贡献徽章。": "Accepted fixes light up a contributor badge.", "视状态缩短当日行程。": "Shorten the day's ride as needed.", "触发距离": "Trigger distance", "让每一位摩友的经验，都能帮到路上的下一个人。": "Every rider's experience helps the next one on the road.", "让每一次组队，都像一场属于自己的赛事。": "Make every group ride feel like your own race.", "让骑士成为最懂你路线和口味的旅伴。": "Make Knight the companion who knows your routes and tastes.", "记下道路名称与附近地标。": "Note the road name and nearby landmarks.", "记录麻烦，旅程只剩模糊记忆": "Recording is a hassle; trips fade to blurry memories", "设备直连": "Device link", "设置集合点": "Set meetup", "识别地标": "Identify landmark", "试听回答": "Hear answer", "试听播报": "Hear alert", "语言 Language": "Language", "语音回复": "Voice reply", "语音标危险": "Voice hazard marks", "语音消息": "Voice messages", "语音瞬间抓拍": "Voice snapshot", "语音触发快门，海拔和坐标随照片汇入车队地图相册。": "Voice-triggered shutter; altitude and GPS go to the crew map album.", "请确认自身状态。": "Please confirm you're OK.", "谁在哪、前面有什么，全队同步，平安一起到。": "Who's where, what's ahead: the whole crew in sync, arriving safe together.", "贡献 # 段云海高光": "Contributed # sea-of-clouds clips", "资金用途": "Use of funds", "越用越懂你": "Learns You", "距离标记点 # m": "# m to marker", "距领队 # km": "# km to leader", "路再远，": "However far,", "路况": "Road", "路况标记": "Road marks", "路在眼前，歌在耳边": "Road in view, music in your ear", "路线剖面示意": "Route profile", "跳到片段": "Jump to clip", "身体发出的信号，骑行中最容易忽略。": "Body warnings are the easiest to ignore while riding.", "车型专属知识": "Model-specific know-how", "车打不着火，搜不到也问不到。": "Bike won't start; no signal, nobody to ask.", "车距": "Gap", "车轮气门嘴上的胎压胎温传感器": "Tire pressure/temp sensor on the valve stem", "车辆健康档案": "Bike health file", "车速 # km/h · 自由通话已收起": "# km/h · free talk folded", "车队": "Crew", "车队 / 组队数": "Crews / groups", "车队 HUD": "Crew HUD", "车队 · 一起记录": "Crew · Ride Records", "车队 · 安全互助": "Crew · Crew Safety", "车队 · 组队娱乐": "Crew · Ride Together", "车队位置、排名、标记": "Crew positions, ranks, marks", "车队功能分类": "Crew features", "车队功能让一个人带来一群人，用户越多越难离开。": "Crew features turn one rider into many; more users, harder to leave.", "车队同听一份歌单，导航播报时统一降低音量。": "Crew shares one playlist; volume dips together for nav prompts.", "车队同行": "Crew rides", "车队娱乐": "Crew fun", "车队娱乐功能": "Crew fun features", "车队娱乐展示方式": "Crew fun views", "车队安全": "Crew safety", "车队安全场景": "Crew safety scenarios", "车队安全展示方式": "Crew safety views", "车队实时排位": "Live crew ranking", "车队成片播放进度": "Crew film progress", "车队状态": "Crew status", "车队生活库": "Crew library", "车队竞技与安全互助": "Crew racing & mutual aid", "车队竞技挑战中的骑手们": "Riders in a crew challenge", "车队竞技榜 · 实时同步": "Crew leaderboard · live", "车队竞技赛": "Crew race", "车队记录": "Crew records", "车队记录功能": "Crew record features", "车队记录展示方式": "Crew record views", "车队语音频道": "Crew voice channel", "车队越多，路上遇到的问题和解决办法越多，持续汇入骑行知识库。": "More crews, more problems and fixes on the road, all flowing into the knowledge base.", "车队频道待接通": "Crew channel pending", "车队｜骑士 Knight": "Crew | Knight", "轨迹收尾": "Track wrap-up", "软硬件 + 社区一体": "Hardware + software + community", "近距直连": "Short-range link", "这条有用 · 回流社区": "Helpful · share back", "进入无网路段前，自动缓存沿途常见问题。": "Before dead zones, common issues along the route are cached.", "连续右弯 · 语音引导中": "Right curves · voice guidance", "连续骑行": "Ride time", "连续骑行 # 小时": "# h nonstop", "连起每一支车队": "Connect every crew", "追尾、胎压、疲劳高反预警": "Rear-end, tire, fatigue & altitude alerts", "追尾预警": "Rear-end alert", "追尾预警、胎压胎温、车队协同，都是为骑行专门做的。": "Rear-end alerts, tire data, crew sync: all built for riding.", "选择路况，模拟领队发出语音标记。": "Pick a road hazard; the leader marks it by voice.", "选择路线点位": "Pick a route point", "通用 AI 眼镜": "Generic AI glasses", "通用问答": "Generic Q&A", "通知领队，在安全地点统一停靠。": "Tell the leader; regroup somewhere safe.", "通话限速保护": "Speed-safe calls", "遇到问题，荒郊无人可问": "Stuck in the wild, nobody to ask", "遇险事件": "Incident", "遇险报文已在队内送达，等待恢复信号后补传云端。": "SOS delivered within the crew; uploads to cloud when signal returns.", "避开井盖、标线和落叶等湿滑点": "Avoid manholes, road paint, wet leaves", "邀请中": "Inviting", "邀请卡已生成：“下周末一起跑 #？” 摩友点开即可加入你的车队。": "Invite card ready: \"Ride # next weekend?\" Riders tap to join your crew.", "邀请码 KN# · 周六 # 康定出发": "Code KN# · Sat # from Kangding", "都有骑士同行。": "Knight rides along.", "配合胎压传感器观察是否继续漏气": "Watch the tire sensor for further leaks", "里程": "Distance", "重播测距": "Replay ranging", "链条异响": "Chain noise", "链条异响 · 先看松紧和润滑": "Chain noise · check tension & lube", "链条异响多半是缺油或松紧不对。停车后先看链条下垂量，再补链条油。": "Chain noise usually means dry or wrong tension. Check the slack, then lube it.", "镇口加油站 · # km": "Town gas station · # km", "镜架微镜头 · # m": "Frame micro-cam · # m", "镜片 · 社区召回": "Lens · community recall", "镜片拍照": "Lens photo", "镜片视角": "Lens view", "长成摩友的社区": "Grow a rider community", "长途后链条异响、跳齿": "Chain rattles and skips after long rides", "长途摩旅": "Long-distance touring", "长途疲劳": "Long-ride fatigue", "问加油站": "Find gas", "队内位置同步": "Crew location sync", "队内语音": "Crew voice", "队内语音频道": "Crew voice channel", "队内通话 · 限速保护": "Crew calls · speed-safe", "队友及联系人": "Teammates & contacts", "队友影像按地理点位自动归集": "Teammates' footage grouped by location", "队友戴上眼镜自动入队": "Teammates join by putting on glasses", "阵雨": "Showers", "阿": "A", "阿哲": "A-Zhe", "阿哲 · # 号": "A-Zhe · No. #", "阿哲 · # 号 ↗": "A-Zhe · No. # ↗", "阿哲 · 最稳护航官": "A-Zhe · Steadiest escort", "险情全队互助": "Crew hazard response", "随行功能": "Companion", "集结广播已送达 # 台眼镜，导航目的地已同步为镇口加油站。": "Meetup broadcast sent to # glasses; nav set to the town gas station.", "雨后山路过弯后轮打滑": "Rear wheel slides on wet mountain corners", "雨天受困": "Stuck in rain", "雨天山路弯道上的骑手": "Rider on a wet mountain curve", "雨天山路第一视角与天气预警示意": "First-person rainy mountain road with weather alert", "雨天过弯": "Rain cornering", "雨天过弯 · 三个要点": "Rain cornering · three tips", "静音": "Mute", "非骑行设计": "Not built for riding", "音乐 · 旅途": "Music · road", "页面导航": "Page navigation", "预览垭口日落": "Preview pass sunset", "预览山谷晨雾": "Preview valley mist", "预览山路弯道": "Preview mountain curves", "预警准了、记录自动了，骑行变得轻松，出门的次数自然更多，留下的数据也更多。": "Accurate alerts, automatic records: riding gets easier, people ride more, and leave more data.", "领航": "Navigator", "领队": "Leader", "领队可在镇口设置集合点，全队同步导航。": "Leader sets a meetup at the town entrance; whole crew navigates there.", "领队总结的 # 条雨天压弯要点": "Leader's # tips for wet cornering", "领队播报湿滑路段，约定集合点。": "Leader flags slippery stretches, sets a meetup.", "领队路况标记": "Leader road marks", "领队通过语音标记路况，后车靠近标记点时收到镜片和语音预警。": "The leader marks hazards by voice; riders behind get lens and voice alerts near the spot.", "首次 # m+": "First # m+", "首页": "Home", "骑士": "", "骑士 App": "Knight App", "骑士 KNIGHT · 摩托车 AI 眼镜": "KNIGHT · AI glasses for motorcyclists", "骑士 Knight": "Knight", "骑士 Knight 首页": "Knight home", "骑士 Knight｜摩托车 AI 眼镜 · 路演": "Knight | AI glasses for motorcyclists · Pitch", "骑士知道你的极限在哪：骑多久该歇、哪段海拔要当心、哪种路况你更需要提醒。": "Knight knows your limits: when to rest, which altitude to watch, which roads need more warnings.", "骑士社区": "Community", "骑士社区 · 摩友怎么做": "Community · what riders do", "骑士社区展示方式": "Community views", "骑士社区｜骑士 Knight": "Community | Knight", "骑士都在。": "Knight is there.", "骑得快时只保留一键预警，语音消息自动转成播报；低速或停车后恢复双向通话。": "At speed only one-tap alerts remain and voice messages become read-outs; two-way talk returns when slow or stopped.", "骑手休息时的健康数据叠加示意": "Rider resting with health data overlay", "骑手停在寺塔旁，眼镜识别沿途地标": "Rider by a temple tower; glasses identify the landmark", "骑手停在山间，镜片前浮现摩友经验卡片": "Rider in the mountains; rider tips float in the lens", "骑手在垭口海拔牌前庆祝打卡": "Rider celebrating at a pass altitude sign", "骑手在路边查看扎胎的后轮": "Rider checking a flat rear tire by the road", "骑手心率趋势": "Rider heart rate trend", "骑手的六个难处": "Six rider pain points", "骑手蹲下检查摩托车链条": "Rider crouching to inspect the chain", "骑行与健康数据": "Ride & health data", "骑行专属整理与打卡": "Ride-specific curation & check-ins", "骑行中一句「你好骑士」，从知识库调出答案讲给你听": "Say \"Hey Knight\" mid-ride; the answer comes from the knowledge base to your ear", "骑行中一句话召回答案": "Answers on voice, mid-ride", "骑行场景需求": "Riding needs", "骑行数据 + 社区真实案例，时间越长越难复制。": "Ride data + real community cases: harder to copy over time.", "骑行时长": "Ride time", "骑行时间": "Ride time", "骑行歌单共享": "Shared ride playlist", "骑行知识库 · 召回结果": "Knowledge base · results", "骑行结束后，AI 按全队的路线和影像生成高光榜。": "After the ride, AI builds a highlight board from routes and footage.", "骑行问题知识召回": "Riding Q&A recall", "骑行高光榜": "Ride highlights", "骑车的人，缺一双「第二双眼睛」": "Riders need a second pair of eyes", "高原不适": "Altitude sickness", "高原公路上动力不足的摩托车": "Bike losing power on a highland road", "高原反应": "Altitude", "高原空气稀薄，动力下降很常见。放慢节奏、提前降挡爬坡，人和车都别硬撑。": "Thin air at altitude cuts power. Slow down, downshift early on climbs; don't push you or the bike.", "高原车没劲": "Weak at altitude", "高原车没劲 · 人车都要缓": "Weak at altitude · ease off", "高反呼吸引导": "Altitude breathing guide", "高反和疲劳，总想再撑一会儿": "Altitude & fatigue: always \"just a bit more\"", "高海拔不适时，语音带你做呼吸节奏调整。": "At altitude, voice guides your breathing rhythm.", "高海拔动力下降属常见现象，降低预期车速": "Power drops at altitude; lower your expected speed", "高海拔垭口上的骑手与血氧海拔叠加示意": "Rider at a high pass with SpO2 and altitude overlay", "高海拔路段": "High altitude", "高速状态：仍可一键发送「前方危险」「我要停车」等预警。": "At speed: one-tap \"Danger ahead\" or \"Stopping\" alerts still work.", "高速骑行时镜片内只保留一键预警的通话界面示意": "At speed only the one-tap alert call screen stays in the lens", "黄昏营地里，摩友们围坐交流骑行经验": "Riders sharing tips around a campfire at dusk", "黄金时刻，独自骑行在山路上的骑手": "Lone rider on a mountain road at golden hour", "让每一位摩友，都能安心骑完想去的每一程。": "Every rider, every road they dream of, safely home.", "愿景": "Vision", "组队骑行": "Group Rides", "组队骑行 · 组队娱乐": "Group Rides · Ride Together", "组队骑行 · 安全互助": "Group Rides · Crew Safety", "组队骑行 · 一起记录": "Group Rides · Ride Records", "组队骑行｜骑士 Knight": "Group Rides | Knight", "# 号车已收到返回路线、# 号车坐标与应急指引。": "Bike # has a route back, plus bike #'s location and emergency guide.", "低速 # km/h · 已恢复双向通话": "Slow # km/h · two-way talk restored", "已同步 # 条": "# synced", "已开放 · 可接通领队": "Open · can call the leader", "已接通领队通话，风噪过滤开启；车速回升后自动收起。": "Connected to the leader, wind noise filtered; folds away when speed rises.", "已连接": "Connected", "模拟加速到 # km/h": "Speed up to # km/h", "模拟进入无网路段": "Enter a dead zone", "网络恢复，报文已补传": "Back online, messages uploaded", "蜂窝网络恢复，# 条离线报文已补传至云端。": "Cell signal back; # offline messages uploaded to the cloud.", "附近扫一扫，或面对面建群": "Scan nearby, or group up face to face", "App 扫描附近摩友一键邀请，或面对面输入同一个 # 位数自动入群，眼镜同步确认。": "The App finds riders nearby and invites them, or everyone enters the same 4 digits to join; the glasses confirm.", "附近 # km 摩友，自动邀请": "Riders within 3 km, invited automatically", "面对面输 # 位数，全员入群": "Same 4 digits face to face, everyone joins", "全队位置，一条线看清": "The whole crew on one line", "每台车的位置实时上图，排名和间距随骑随变。": "Every bike is on the map live; ranks and gaps update as you ride.", "编号与颜色对应每位车手": "A number and color for each rider", "排名实时重排": "Ranking reorders live", "掉队过远自动提醒": "Auto alert when someone drops too far back", "路段竞速，像一场比赛": "Segment racing, like a real race", "选定一段路，起终点自动计时，分段成绩和名次同步到每副眼镜。": "Pick a stretch of road: start and finish are timed automatically, splits and places sync to every pair of glasses.", "起终点自动计时": "Automatic start and finish timing", "分段成绩语音播报": "Splits read out by voice", "冲线即出领奖台": "Podium the moment you cross the line", "同路摩友，开口就能聊": "Talk to riders on the same road", "同路雷达发现前方同向车队，说话直达对方眼镜，对方回话实时转成字幕。": "Ride radar spots a crew ahead going your way; your voice reaches their glasses and their replies become live captions.", "同向车队自动发现": "Crews going your way, found automatically", "语音直达对方眼镜": "Your voice goes straight to their glasses", "回话实时转字幕": "Replies turned into live captions", "收车就有全队高光榜": "Crew highlights the moment you park", "骑行结束，AI 按全队的路线、数据和影像自动评出今日荣誉。": "When the ride ends, AI picks today's honors from the crew's routes, data and footage.", "里程、爬升自动统计": "Distance and climb tallied automatically", "最远 · 最快 · 最稳 · 摄影担当": "Longest · fastest · steadiest · best shooter", "一键分享到车队群": "Share to the crew chat in one tap", "# bpm": "# bpm", "包含本次语音抓拍 # 张": "Includes # voice-triggered shot(s)", "最近一张已归入折多山垭口": "Latest shot filed under Zheduo Pass", "碎石预警 · #/# 名后方队友已收到。": "Gravel alert · #/# riders behind have it.", "路况已标记 · 等待后车接近 # m。": "Hazard marked · waiting for riders behind to get within # m.", "骑士 Knight｜摩托车 AI 眼镜": "Knight | AI glasses for motorcycle riders", "骑士 Knight 连接摩托车 AI 眼镜、手机 App 与骑友社区。骑行时听路况、连队友，收车后回看沿途影像。": "Knight connects riding glasses, an app and a rider community for road alerts, crew calls and ride memories.", "听听骑士的提醒": "Hear a riding alert", "静音查看骑行预警": "View alerts without sound", "川西车队骑行短片，60 秒，含配乐": "Western Sichuan crew ride film, 60 seconds, with music", "查看骑行场景": "Explore riding scenarios", "骑行场景": "Riding scenarios", "骑行细节": "Ride details", "封闭路段": "Closed course", "G318 · 车队位置": "G318 · crew positions", "听弯道提醒": "Hear a bend alert", "邀请下一位队友": "Invite the next rider", "重新组队": "Start a new crew", "查看超车抓拍": "See the passing shot", "用口令组队": "Join with a code", "跟前车打招呼": "Greet the riders ahead", "可在这张分享卡上查看今日车队荣誉。": "Today’s crew awards are on this share card.", "已生成车队分享卡": "Crew share card ready", "生成车队分享卡": "Create a crew share card", "骑手视角的路面与镜片提示": "The road and lens alerts from the rider’s perspective", "胎压骤降": "Tire pressure drops", "队友掉队": "A rider falls behind", "骑手有 15 秒确认安全，本页仅展示求助流程。": "The rider has 15 seconds to respond. This page shows the SOS sequence only.", "查看摔车求助流程": "View crash SOS", "SOS 回执示例": "Example SOS receipt", "求助卡附有位置和事故类型，本页不会联系救援。": "The SOS card includes the location and incident type. This page does not contact rescuers.", "已确认安全，倒计时结束。": "Rider checked in safe. Countdown stopped.", "重看求助过程": "Replay the SOS sequence", "倒计时加速回放": "Countdown in fast-forward", "开始录像": "Start recording", "语音打卡": "Check in by voice", "选择路况，听领队为后车标记危险。": "Choose a hazard to hear the leader warn the riders behind.", "语音标记路况": "Mark a hazard by voice", "减速至 25 km/h": "Slow to 25 km/h", "查看 68 km/h 时的通话状态": "See call status at 68 km/h", "查看联网后的消息": "See messages after reconnecting", "进入无信号路段": "Enter a coverage gap", "说「拍一张」": "Say “take a photo”", "骑手镜头 · 录像画面": "Rider’s lens · recording view", "此设备可查看导航播报时的音量变化。": "This device shows how music volume changes during navigation.", "摩友问答与经验": "Rider Q&A and advice", "组队和记录": "Crew and ride log", "问骑友": "Ask riders", "骑友分享亲历案例": "Riders share firsthand experiences", "经验分享": "Shared experience", "眼镜 · 骑友问答": "Glasses · rider Q&A", "骑友经验 · 相关案例": "Rider advice · related cases", "这条经验有用": "This advice helped", "已标记有用": "Marked as helpful", "已记下你的反馈，方便下一位摩友找到这条经验。": "Your feedback helps the next rider find this advice.", "说出问题，骑士会结合车型和路况，读出相似案例中的办法。": "Ask a question and Knight reads out advice from riders who faced similar conditions on a similar bike.", "收录骑友经验": "Save rider advice", "说出问题，听骑友的经验": "Ask by voice and hear other riders’ advice", "向眼镜提问，听骑友的处理办法 →": "Ask the glasses how other riders handled it →", "骑行记录如何改善提醒": "How ride logs inform alerts", "个人记录、车队分享与骑行提醒之间的关系图": "How ride logs, crew experiences and personal alerts connect", "更快找到相似经历": "Find similar cases faster", "下一位摩友提问时，骑士可以结合车型和路况，找出前人试过的办法。": "When another rider asks, Knight can find what worked on a similar bike and road.", "依次了解六个环节": "Explore the six steps", "查看骑行记录的用处": "Explore how ride logs help", "从行程到提醒": "From ride logs to alerts", "找到 3 条骑友经验": "Found 3 rider tips", "3 条相似经历 · 川西、滇西": "3 similar cases · western Sichuan and Yunnan", "4 条相似经历 · 参考胎压数据": "4 similar cases · tire pressure considered", "2 条骑友经历和 1 条公开案例": "2 rider experiences and 1 public case", "3 条相似经历 · 当前海拔 4,520 m": "3 similar cases · current altitude 4,520 m", "3 条领队经验 · 前方有雨": "3 crew leaders’ tips · rain ahead", "骑士参考骑行时长、海拔变化和你以往的休息时间，选择提醒的时机。": "Knight uses ride duration, altitude changes and past breaks to time a reminder.", "每次收车都有一份记录，下次出发时能回看上次在哪里休息。": "Each ride leaves a log so you can see where you took a break last time.", "分享行程，邀请同骑": "Share a ride and invite a friend", "把沿途短片和路线做成邀请卡，约朋友下一次一起骑。": "Put the film and route on an invitation card for your next ride together.", "归档": "File cases", "查找": "Find answers"};
/* ===== v4: 中 / EN ===== */
(() => {
  const D = Object.assign(window.KNIGHT_EN || {}, {"浏览骑行场景": "Explore scenarios", "摩托车 AI 眼镜": "AI glasses for motorcyclists", "听路况，连队友，拍下眼前的风景。": "Hear road alerts, talk to your crew and capture the view.", "守护": "Safety", "组队": "Crew", "社区": "Community", "查看下一处部件": "Explore the next component", "镜片贴近视线，导航与预警抬眼可见。": "Navigation and alerts stay in view inside the helmet."});
  const HAN = /[\u3400-\u9fff\uff01-\uff5e「」“”]/;
  const ATTRS = ['alt', 'aria-label', 'title', 'placeholder'];
  const texts = new Map(), attrs = new Map();
  const missing = window.__i18nMissing = new Set();
  let lang = 'zh';
  try { lang = localStorage.getItem('knight-lang') === 'en' ? 'en' : 'zh'; } catch (e) {}
  function tr(str) {
    const t = str.trim();
    if (!t || !HAN.test(t)) return null;
    if (D[t] != null) return str.replace(t, D[t]);
    const nums = [];
    const k = t.replace(/\d[\d,.:]*/g, m => { nums.push(m); return '#'; });
    if (nums.length && D[k] != null) { let i = 0; return str.replace(t, D[k].replace(/#/g, () => nums[i++] ?? '')); }
    missing.add(t);
    return null;
  }
  function skip(n) { const p = n.parentElement; return !p || p.closest('script,style,noscript,.kx,.kx-hots,.kx-hint'); }
  function doText(n) {
    if (skip(n)) return;
    const rec = texts.get(n), v = n.nodeValue;
    if (rec && v === rec.en) return;
    const en = tr(v);
    if (en == null) { if (rec) texts.delete(n); return; }
    texts.set(n, {zh: v, en}); n.nodeValue = en;
  }
  function doAttrs(el) {
    if (el.closest && el.closest('.kx,.kx-hots,.kx-hint')) return;
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      let m = attrs.get(el); const v = el.getAttribute(a);
      if (m && m[a] && m[a].en === v) continue;
      const en = tr(v); if (en == null) continue;
      if (!m) attrs.set(el, m = {});
      m[a] = {zh: v, en}; el.setAttribute(a, en);
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 || root.closest('script,style')) return;
    doAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n; while ((n = tw.nextNode())) { if (n.nodeType === 3) doText(n); else if (!/^(SCRIPT|STYLE)$/.test(n.tagName)) doAttrs(n); }
  }
  const titleZh = '骑士 Knight｜摩托车 AI 眼镜';
  function setTitle() {
    if (lang !== 'en') return;
    if (document.title.includes('｜骑士 Knight') && !HAN.test(document.title.replace('｜骑士 Knight', ''))) { document.title = document.title.replace('｜骑士 Knight', ' | Knight'); return; }
    const t = tr(document.title); if (t != null) document.title = t;
  }
  function zhTitle() {
    const pg = document.querySelector('[data-page]:not([hidden])');
    if (!pg || pg.dataset.page === 'home') document.title = titleZh;
    else { const h = pg.querySelector('h1'); if (h) document.title = h.textContent + '｜骑士 Knight'; }
  }
  const mo = new MutationObserver(list => {
    if (lang !== 'en') return;
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttrs(m.target);
      else m.addedNodes.forEach(walk);
    }
  });
  function apply(next) {
    lang = next;
    try { localStorage.setItem('knight-lang', lang); } catch (e) {}
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    if (lang === 'en') {
      walk(document.body); setTitle();
      mo.observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS});
    } else {
      mo.disconnect();
      texts.forEach((r, n) => { if (n.nodeValue === r.en) n.nodeValue = r.zh; }); texts.clear();
      attrs.forEach((m, el) => { for (const a in m) if (el.getAttribute(a) === m[a].en) el.setAttribute(a, m[a].zh); }); attrs.clear();
      zhTitle();
    }
    window.dispatchEvent(new CustomEvent('ride:lang', {detail: lang}));
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-lang]'); if (b && b.dataset.lang !== lang) apply(b.dataset.lang); });
  window.addEventListener('ride:route', () => setTimeout(setTitle, 0));
  window.knightLang = apply;
  if (lang === 'en') apply('en');
})();

/* ===== v6 · Knight interactive demo stage (kx) ===== */
(() => {
  const isEn = () => document.documentElement.lang === 'en';
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const T = (zh, en) => '<span data-zh="' + esc(zh) + '" data-en="' + esc(en) + '">' + esc(isEn() ? en : zh) + '</span>';
  const TT = a => Array.isArray(a) ? T(a[0], a[1]) : esc(a);
  const P = {
    alert:'<path d="M12 3 2 20h20L12 3z"/><path d="M12 9.5v4.5M12 17v.4"/>',
    tire:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21"/>',
    heart:'<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/><path d="M6 12h3l1.5-2.5 2 5 1.5-2.5h4"/>',
    crash:'<path d="M12 2v4M4.9 4.9l2.8 2.8M2 12h4M19.1 4.9l-2.8 2.8M22 12h-4"/><circle cx="12" cy="15" r="5"/>',
    sos:'<path d="M5 12a7 7 0 0 1 14 0M8 12a4 4 0 0 1 8 0"/><circle cx="12" cy="12" r="1.5"/><path d="M12 14v7"/>',
    nav:'<path d="M6 20V11a4 4 0 0 1 4-4h8"/><path d="m14 3 4 4-4 4"/>',
    music:'<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    msg:'<path d="M4 5h16v11H9l-5 4V5z"/><path d="M8 9.5h8M8 12.5h5"/>',
    phone:'<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
    film:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3V9z"/>',
    pin:'<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 6 4.8"/>',
    chat:'<path d="M4 4h16v12H8l-4 4V4z"/><path d="M9 10h.01M12 10h.01M15 10h.01"/>',
    book:'<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4V4zM20 4h-5a2 2 0 0 0-2 2"/><path d="M20 4v14h-5a2 2 0 0 0-2 2"/>',
    check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    camera:'<path d="M4 8h3l2-3h6l2 3h3v11H4V8z"/><circle cx="12" cy="13" r="3.5"/>',
    spark:'<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    flag:'<path d="M5 21V4h11l-2 4 2 4H5"/>',
    medal:'<circle cx="12" cy="14" r="6"/><path d="M8.5 3 12 8l3.5-5"/><path d="m12 11.5.9 1.8 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z"/>'
  };
  const svg = (n, cls='i') => '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[n] || '') + '</svg>';
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>';
  const STEPS = [['发生','What happens'],['骑士反应','Knight reacts'],['解决','Result']];

  /* image (u,v) in natural pixels-fraction -> host px, honouring object-fit:cover + object-position */
  function imgPt(host, img, u, v) {
    const hr = host.getBoundingClientRect();
    if (!img || !img.naturalWidth) return {x: u * hr.width, y: v * hr.height, s: hr.width};
    const W = img.offsetWidth || hr.width, H = img.offsetHeight || hr.height;
    const sc = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
    const pos = (getComputedStyle(img).objectPosition || '50% 50%').split(' ');
    const px = parseFloat(pos[0]) / 100, py = parseFloat(pos[1] || pos[0]) / 100;
    const ox = (W - dw) * (isNaN(px) ? .5 : px), oy = (H - dh) * (isNaN(py) ? .5 : py);
    const ir = img.getBoundingClientRect();
    const baseX = img.offsetParent === host ? img.offsetLeft : (ir.left - hr.left), baseY = img.offsetParent === host ? img.offsetTop : (ir.top - hr.top);
    return {x: baseX + ox + u * dw, y: baseY + oy + v * dh, s: dw};
  }
  const num = (n, dec) => dec ? n.toFixed(dec) : Math.round(n).toLocaleString('en-US');

  /* ---------- scenes ---------- */
  const SC = {
    brake(k) {
      const c = k.pt(.5, .52), a = k.pt(.457, .49), b = k.pt(.539, .49);
      k.origin(.5, .52);
      return '<div class="kx-sc" data-ph="0"><div class="kx-anchor" style="position:absolute;left:' + c.x + 'px;top:' + c.y + 'px;transform:scale(var(--kx-z,1));transition:transform var(--approach-time,1s) cubic-bezier(.18,.75,.25,1)">' +
        '<i class="kx-tl" style="left:' + (a.x - c.x) + 'px;top:' + (a.y - c.y) + 'px"></i><i class="kx-tl" style="left:' + (b.x - c.x) + 'px;top:' + (b.y - c.y) + 'px"></i>' +
        '<div class="kx-ret" style="left:0;top:0;width:' + Math.max(90, c.s * .16) + 'px;height:' + Math.max(60, c.s * .1) + 'px"><b>42 m</b></div></div>' +
        '<div class="kx-gapbar"><i style="--g:90%"></i></div></div>';
    },
    tire(k) {
      const p = k.pt(.47, .3);
      return '<div class="kx-sc" data-ph="0"><i class="kx-ping" style="left:' + p.x + 'px;top:' + p.y + 'px"></i>' +
        '<div class="kx-card kx-gauge"><small>' + T('胎压胎温 · 实时','Tire pressure & temp · live') + '</small>' +
        '<div class="row"><span>' + T('前轮','Front') + '</span><b>2.3 bar · 42°C</b></div>' +
        '<div class="row bad"><span>' + T('后轮','Rear') + '</span><b><span data-c="p">2.3</span> bar · <span data-c="t">42</span>°C</b></div>' +
        '<div class="kx-meter"><i style="--m:90%"></i></div></div></div>';
    },
    route() {
      return '<div class="kx-sc" data-ph="0"><div class="kx-card kx-arrow"><svg viewBox="0 0 24 24">' + P.nav + '</svg><div><div class="kx-big"><span data-c="d">600</span> m</div><small>' + T('连续右弯','Right-hand curves') + '</small></div></div>' +
        '<div class="kx-card kx-route"><small>' + T('导航 · 新都桥','Navigation · Xinduqiao') + '</small><svg viewBox="0 0 220 110"><path class="base" d="M14 96 C60 96 50 50 96 54 S140 92 168 60 S190 18 206 14"/><path class="rt" d="M14 96 C60 96 50 50 96 54 S140 92 168 60 S190 18 206 14"/><circle cx="14" cy="96" r="5" fill="#7fd6ff"/><circle cx="206" cy="14" r="5" fill="#f2b45c"/></svg>' +
        '<div class="kx-vol">' + svg('music') + '<span>' + T('旅途歌单','Road playlist') + '</span><div class="kx-meter"><i></i></div><b data-c="v">76%</b></div></div></div>';
    },
    msg() {
      return '<div class="kx-sc" data-ph="0"><div class="kx-card kx-msg"><div class="hd"><span class="kx-av">' + T('王','W') + '</span><div><b>' + T('老王 · 微信','Lao Wang · WeChat') + '</b><small>' + T('眼镜语音读出','Read aloud by glasses') + '</small></div></div><p>' + T('到哪了？垭口等你','Where are you? Waiting at the pass') + '</p><div class="st">✓ ' + T('已回复：「二十分钟到」','Replied: "20 minutes away"') + '</div></div>' +
        '<div class="kx-card kx-call"><span class="kx-av">' + T('妈','M') + '</span><div><b>' + T('妈妈 来电','Mom calling') + '</b><em data-c="cs">' + T('来电中…','Incoming…') + '</em></div></div></div>';
    },
    vlog(k) {
      const p = k.pt(.63, .72), hr = k.host.getBoundingClientRect();
      const tiles = [['压弯','Lean-in','#2f4a63,#c98a3e'],['垭口日落','Pass sunset','#5a3a2a,#f2a95c'],['队友挥手','Teammate wave','#27403a,#7fbfa0'],['云海','Sea of clouds','#3a4c6a,#d8dfe8']];
      const tl = {x: hr.width * .05, y: hr.height * .16};
      return '<div class="kx-sc kx-sc-vlog" data-ph="0"><div class="kx-tiles">' + tiles.map((t, i) => '<div class="kx-tile" style="background:linear-gradient(150deg,' + t[2] + ');--fx:' + Math.round(p.x - tl.x - 60 - (i % 2) * 150) + 'px;--fy:' + Math.round(p.y - tl.y - 40 - Math.floor(i / 2) * 100) + 'px">' + T(t[0], t[1]) + '</div>').join('') + '</div>' +
        '<div class="kx-screen" style="left:' + p.x + 'px;top:' + p.y + 'px;width:' + Math.max(64, p.s * .085) + 'px;height:' + Math.max(110, p.s * .16) + 'px"><div><span class="play">' + PLAY.replace('<svg', '<svg style="width:12px;height:12px;fill:currentColor"') + '</span><b data-c="vt">' + T('AI 剪辑中','AI editing') + '</b><div class="kx-meter" style="margin-top:6px"><i style="--m:0%"></i></div></div></div></div>';
    },
    checkin() {
      return '<div class="kx-sc" data-ph="0"><div class="kx-card kx-prof"><small>' + T('康定 → 折多山 → 新都桥','Kangding → Zheduo Pass → Xinduqiao') + '</small><svg viewBox="0 0 260 90"><path class="ln" d="M4 80 C40 76 60 70 90 52 S130 8 150 10 S190 50 220 56 256 60 256 60"/><path class="done" d="M4 80 C40 76 60 70 90 52 S130 8 150 10 S190 50 220 56 256 60 256 60"/><circle data-dot r="6" cx="4" cy="80" fill="#f2b45c"/></svg><div style="display:flex;justify-content:space-between;font-size:12px"><span>' + T('海拔','Altitude') + '</span><b><span data-c="alt">2,560</span> m</b></div></div>' +
        '<div class="kx-card kx-badge"><div class="medal">' + svg('medal') + '</div><b>' + T('垭口收集 2 / 3','Passes collected 2 / 3') + '</b><small style="margin:4px 0 0">' + T('折多山垭口 · 4,298 m','Zheduo Pass · 4,298 m') + '</small></div>' +
        '<div class="kx-card kx-invite"><small>' + T('邀请卡','Invite card') + '</small><b style="font-size:15px">' + T('下周末一起跑 318？','Ride 318 next weekend?') + '</b><div class="kx-avs"><span style="background:#3d7a4f">' + T('王','W') + '</span><span style="background:#6a4a8a">' + T('周','Z') + '</span><span style="background:#8a5a2a">' + T('林','L') + '</span><span style="background:#2a5a8a">' + T('哲','A') + '</span></div></div></div>';
    },
    feeds() {
      return '<div class="kx-sc" data-ph="0"><div class="kx-feeds">' + [0,1,2,3].map(i => '<div class="kx-feed"><span>' + T('眼镜 0' + (i + 1), 'Glasses 0' + (i + 1)) + '</span><i style="--off:' + (i * 18) + 'px"></i></div>').join('') + '</div></div>';
    },
    pins(k) {
      const pts = [[.16,.72,'康定 · 2,560 m','Kangding · 2,560 m'],[.42,.34,'折多山 · 4,298 m','Zheduo · 4,298 m'],[.66,.56,'新都桥 · 3,460 m','Xinduqiao · 3,460 m'],[.86,.3,'营地','Camp']];
      const hr = k.host.getBoundingClientRect(), W = hr.width, H = hr.height;
      const d = 'M' + pts.map(p => (p[0] * W).toFixed(0) + ' ' + (p[1] * H).toFixed(0)).join(' L');
      return '<div class="kx-sc" data-ph="0"><div class="kx-pins"><svg viewBox="0 0 ' + W + ' ' + H + '"><path class="rt" d="' + d + '"/></svg>' + pts.map(p => '<span class="kx-tag" style="left:' + p[0] * 100 + '%;top:' + (p[1] * 100 - 7) + '%">' + svg('pin') + ' ' + T(p[2], p[3]) + '</span>').join('') + '</div></div>';
    },
    photo() {
      return '<div class="kx-sc" data-ph="0"><div class="kx-card kx-photo"><i></i><span>' + T('天路十八弯 · 4,180 m','18 Bends · 4,180 m') + '</span></div></div>';
    },
    body() {
      return '<div class="kx-sc kx-sc-body" data-ph="0"><i class="kx-lid t"></i><i class="kx-lid b"></i>' +
        '<div class="kx-mini"><span class="hr">' + svg('heart') + '<b data-c="hr">80</b><small>bpm</small></span><span class="dv"></span><span>' + T('连续骑行','Riding') + ' <b>3 h</b></span><span class="dv"></span><span>' + T('睡眠','Sleep') + ' <b>5.2 h</b></span></div>' +
        '<div class="kx-card kx-rest"><svg viewBox="0 0 220 46"><path class="base" d="M12 34 C62 34 74 12 124 16 S180 30 204 12"/><path class="rt" d="M12 34 C62 34 74 12 124 16 S180 30 204 12"/><circle cx="12" cy="34" r="5" fill="#7fd6ff"/><circle cx="204" cy="12" r="7" fill="#5fd39a"/><text x="204" y="15.5" text-anchor="middle">P</text></svg><div><b>' + T('前方休息区 · 8 km','Rest area · 8 km ahead') + '</b><small>' + T('约 10 分钟 · 已加入导航','About 10 min · added to your route') + '</small></div></div></div>';
    },
    fall(k) {
      const c = k.pt(.5, .64), bike = k.pt(.7, .45), hr = k.host.getBoundingClientRect(), W = hr.width, H = hr.height;
      const tg = [[.2,.24,'users',['队友 · 老王','Teammate · Lao Wang']],[.8,.22,'phone',['紧急联系人','Emergency contact']],[.8,.84,'pin',['车队群 · 位置已共享','Crew chat · location shared']]];
      return '<div class="kx-sc kx-sc-fall" data-ph="0"><i class="kx-impact" style="left:' + bike.x + 'px;top:' + bike.y + 'px"><b></b><b></b><b></b></i>' +
        '<div class="kx-card kx-ask"><div class="rg"><svg viewBox="0 0 124 124"><circle class="bg" cx="62" cy="62" r="54"/><circle class="fg" cx="62" cy="62" r="54"/></svg><b><span data-c="cd">15</span><small>s</small></b></div>' +
        '<div class="tx"><strong>' + T('你还好吗？','Are you OK?') + '</strong><small>' + T('无应答将自动求救','No reply means auto SOS') + '</small><em class="nr">' + T('无应答','No response') + '</em><small class="sp">' + T('倒计时加速回放','Countdown in fast-forward') + '</small></div></div>' +
        '<div class="kx-sos"><svg viewBox="0 0 ' + W + ' ' + H + '">' + tg.map((t, i) => '<line pathLength="1" style="transition-delay:' + i * .25 + 's" x1="' + c.x + '" y1="' + c.y + '" x2="' + t[0] * W + '" y2="' + t[1] * H + '"/>').join('') + '</svg><i class="kx-ping red" style="left:' + c.x + 'px;top:' + c.y + 'px"></i>' +
        tg.map((t, i) => '<span class="kx-tag" style="left:' + t[0] * 100 + '%;top:' + t[1] * 100 + '%;transition-delay:' + (.5 + i * .25) + 's">' + svg(t[2]) + ' ' + T(t[3][0], t[3][1]) + '</span>').join('') + '</div></div>';
    },
    gas() {
      return '<div class="kx-sc" data-ph="0"><div class="kx-card kx-gas"><small>' + T('最近加油站','Nearest gas station') + '</small><div class="kx-big">12 <small style="display:inline;font-size:13px">km</small></div><svg viewBox="0 0 220 70"><path class="base" d="M10 58 C60 58 70 20 120 26 S180 52 210 12"/><path class="rt" d="M10 58 C60 58 70 20 120 26 S180 52 210 12"/><circle cx="10" cy="58" r="5" fill="#7fd6ff"/><circle cx="210" cy="12" r="6" fill="#f2b45c"/></svg><b style="font-size:13px">' + T('镇口加油站 · 约 15 分钟','Town gas station · ~15 min') + '</b></div></div>';
    },
    mark(k) {
      const p = k.pt(.31, .41);
      return '<div class="kx-sc" data-ph="0"><div class="kx-mark" style="left:' + p.x + 'px;top:' + p.y + 'px"><i class="bx"></i><span class="kx-tag">' + svg('pin') + ' ' + T('山间古寺 · 已识别','Hillside temple · identified') + '</span></div></div>';
    },
    group(k, mode) {
      const hr = k.host.getBoundingClientRect();
      const rel = s => { const e = k.host.querySelector(s); if (!e || !e.offsetWidth) return null; const r = e.getBoundingClientRect(); return {x:r.left - hr.left, y:r.top - hr.top, w:r.width, h:r.height}; };
      const ph = rel('.p2-invite .phone') || {x:16, y:40, w:246, h:520}, pov = rel('.p2-invite .pov') || {x:hr.width * .37, y:16, w:hr.width * .6, h:hr.height - 32};
      const av = (r, cls) => '<span class="av' + (cls ? ' ' + cls : '') + '" style="background:' + r[2] + '">' + T(r[0], r[1]) + '</span>';
      const mem = '<ul class="mem">' + OTH().map(r => '<li>' + av(r) + '<span>' + T(r[3][0], r[3][1]) + '</span><em>' + T('邀请中','Inviting') + '</em><i>' + T('已加入','Joined') + ' ✓</i></li>').join('') + '</ul>';
      let body;
      if (mode === 'radar') {
        body = '<div class="ttl">' + T('附近摩友','Riders nearby') + '</div><div class="kx-radar"><i class="r r1"></i><i class="r r2"></i><i class="r r3"></i><i class="sw"></i>' + av(RIDERS[1], 'me') +
          OTH().map((r, i) => '<span class="pt" style="left:' + (50 + r[6] * 42) + '%;top:' + (50 + r[7] * 42) + '%">' + av(r) + '<small>' + r[5] + '</small></span>').join('') + '</div>' +
          '<div class="cnt">' + T('附近 3 km 内','Within 3 km:') + ' <b data-c="n">0</b> ' + T('位摩友','riders') + '</div><div class="cta"><span class="a">' + T('一键邀请','Invite all') + '</span><span class="b">' + T('已自动邀请 4 位','4 invited automatically') + '</span></div>' + mem;
      } else {
        body = '<div class="ttl">' + T('面对面建群','Face-to-face group') + '</div><p class="sub">' + T('和身边摩友输入同一个 4 位数','Everyone enters the same 4 digits') + '</p><div class="dg">' + ['2','6','1','8'].map(d => '<span><b>' + d + '</b></span>').join('') + '</div>' +
          '<div class="kp">' + ['1','2','3','4','5','6','7','8','9','','0',''].map(d => '<span data-k="' + d + '">' + d + '</span>').join('') + '</div>' + mem;
      }
      return '<div class="kx-sc kx-sc-group" data-ph="0"><div class="kx-phone" style="left:' + ph.x + 'px;top:' + ph.y + 'px;width:' + ph.w + 'px;height:' + ph.h + 'px"><div class="scr"><div class="top"><span>9:41</span><b>' + T('骑士 App','Knight App') + '</b><span></span></div>' + body + '</div></div>' +
        '<span class="kx-tag kx-povk" style="left:' + (pov.x + 14) + 'px;top:' + (pov.y + 44) + 'px">' + T('眼镜视角','Glasses view') + '</span>' +
        '<div class="kx-povhud" style="left:' + (pov.x + pov.w / 2) + 'px;top:' + (pov.y + pov.h * .3) + 'px"><div class="ic">' + svg('users') + '</div><div><small>' + T('镜片 HUD','Lens HUD') + '</small><strong>' + T('已加入车队 · 5 人','Joined the crew · 5 riders') + '</strong><div class="kx-avs">' + RIDERS.map(r => '<span style="background:' + r[2] + '">' + T(r[0], r[1]) + '</span>').join('') + '</div></div></div></div>';
    },
    rank() {
      return '<div class="kx-sc kx-cover kx-map" data-ph="0">' + mapSvg(ROUTE_RANK, '<text class="pl" x="70" y="402">' + TS('康定','Kangding') + '</text><text class="pl" x="296" y="60">' + TS('新都桥','Xinduqiao') + '</text><g class="pk" transform="translate(410 300)"><path d="M-14 10 0-14 14 10z"/><text y="28" text-anchor="middle">' + TS('折多山 4,298 m','Zheduo 4,298 m') + '</text></g>', RIDERS) +
        '<div class="kx-lb"><small>' + T('实时排名','Live ranking') + '</small>' + RIDERS.map((r, i) => '<div class="row' + (i === 1 ? ' me' : '') + '" data-i="' + i + '" style="top:' + (24 + i * 30) + 'px"><b class="n" style="background:' + r[2] + '">' + (i + 1) + '</b><span>' + T(r[3][0], r[3][1]) + '</span><em></em></div>').join('') + '</div>' +
        '<div class="kx-gaptag">' + T('3 号 老周','#3 Lao Zhou') + ' · <b></b></div></div>';
    },
    race() {
      return '<div class="kx-sc kx-cover kx-map kx-race" data-ph="0">' + mapSvg(ROUTE_RACE, '<line class="sl"/><line class="fl"/><line class="spl"/><text class="lbl s">' + TS('起点','START') + '</text><text class="lbl f">' + TS('终点','FINISH') + '</text><text class="lbl m">' + TS('分段 1','Split 1') + '</text>', RIDERS) +
        '<div class="kx-timer"><small>' + T('折多山路段竞速 · 6.2 km','Zheduo segment race · 6.2 km') + '</small><b data-c="tm">0:00.0</b></div><div class="kx-cd"><b data-c="cd">3</b></div>' +
        '<div class="kx-card kx-splits"><small>' + T('分段 1 成绩','Split 1') + '</small><div class="rows"></div></div>' +
        '<div class="kx-podium"><small>' + T('冲线 · 领奖台','Finish · podium') + '</small><div class="pd"></div></div></div>';
    },
    greet(k) {
      const L = k.pt(.399, .238), R = k.pt(.724, .332), hr = k.host.getBoundingClientRect();
      const bub = (s, st) => '<div class="kx-bub ' + s + '" style="' + st + '"><div class="hd"><span class="who"></span><span class="kx-wave"><i></i><i></i><i></i><i></i><i></i></span></div><p></p><small></small></div>';
      return '<div class="kx-sc kx-sc-greet" data-ph="0"><i class="kx-ring3" style="left:' + L.x + 'px;top:' + L.y + 'px"></i><i class="kx-ring3 r" style="left:' + R.x + 'px;top:' + R.y + 'px"></i>' +
        bub('l', 'right:' + Math.round(hr.width - L.x + 58) + 'px;top:' + Math.round(L.y) + 'px;max-width:' + Math.round(Math.min(250, L.x - 72)) + 'px') +
        bub('r', 'left:' + Math.round(Math.min(R.x, hr.width - 135)) + 'px;bottom:' + Math.round(hr.height - R.y + 52) + 'px') + '</div>';
    },
    awards() {
      const A = [[0,['最远里程','Longest ride'],['291 km · 含探路','291 km incl. scouting']],[3,['最快冲顶','Fastest climb'],['折多山段 18:42','Zheduo stretch 18:42']],[2,['最稳护航','Steadiest escort'],['全程 0 次急刹','Zero hard brakes']],[4,['摄影担当','Best shooter'],['抓拍 48 张','48 shots captured']]];
      const S = [['s1','286','km',['里程','Distance']],['s2','3,120','m',['爬升','Climb']],['s3','146','',['抓拍','Shots']],['s4','5','',['车手','Riders']]];
      return '<div class="kx-sc kx-cover kx-awd" data-ph="0"><div class="hd"><small>' + T('今日骑行 · 川西 318 小队','Today · W. Sichuan crew 318') + '</small><strong>' + T('今日车队高光榜','Today\'s crew highlights') + '</strong><div class="st">' + S.map(s => '<div><b><span data-c="' + s[0] + '">0</span><i>' + s[2] + '</i></b><small>' + T(s[3][0], s[3][1]) + '</small></div>').join('') + '</div></div>' +
        '<ol class="cards">' + A.map((a, i) => { const r = RIDERS[a[0]]; return '<li><span class="rk">' + (i + 1) + '</span><span class="av" style="background:' + r[2] + '">' + T(r[0], r[1]) + '</span><div><b>' + T(a[1][0], a[1][1]) + '</b><small>' + T(r[3][0], r[3][1]) + ' · ' + T(a[2][0], a[2][1]) + '</small></div><i class="bdg">' + svg('medal') + '</i></li>'; }).join('') + '</ol><div class="share">' + svg('users') + '<span>' + T('已分享到车队群 · 川西 318 小队','Shared to the crew chat · W. Sichuan 318') + '</span><b>✓</b></div></div>';
    },
    cards(k, items, node) {
      return '<div class="kx-sc" data-ph="0"><i class="kx-scan"></i><div class="kx-fly">' + items.map((c, i) => '<div class="kx-card" style="--dx:' + (i % 2 ? 60 : -60) + 'px"><small>' + TT(c[0]) + '</small><b>' + TT(c[1]) + '</b></div>').join('') + '</div>' +
        (node ? '<div class="kx-card kx-node"><div class="medal">' + svg('book') + '</div><b>' + TT(node) + '</b></div>' : '') + '</div>';
    }
  };

  /* ---------- v7: crew data + stylised map ---------- */
  const TS = (zh, en) => '<tspan data-zh="' + esc(zh) + '" data-en="' + esc(en) + '">' + esc(isEn() ? en : zh) + '</tspan>';
  const RIDERS = [
    ['王','W','#ef7b62',['老王','Lao Wang'],0,'0.4 km',-.55,-.45],
    ['我','Me','#f2b45c',['我','Me'],0,'',0,0],
    ['周','Z','#7fd6ff',['老周','Lao Zhou'],0,'1.1 km',.6,-.3],
    ['哲','A','#5fd39a',['阿哲','A-Zhe'],0,'2.3 km',-.35,.6],
    ['林','L','#b996ff',['小林','Xiao Lin'],0,'2.8 km',.55,.5]
  ];
  const ROUTE_RANK = 'M70 384 C150 404 170 322 240 324 S330 374 380 298 S300 198 232 174 S168 86 290 74';
  const ROUTE_RACE = 'M64 300 C150 170 214 410 304 288 S432 160 536 262';
  function mapSvg(route, extra, riders) {
    const ct = [0,1,2,3,4,5].map(i => '<path class="ct" d="M-20 ' + (90 + i * 70) + ' C120 ' + (50 + i * 70) + ' 220 ' + (150 + i * 66) + ' 360 ' + (100 + i * 68) + ' S540 ' + (40 + i * 74) + ' 640 ' + (110 + i * 66) + '"/>').join('');
    return '<svg class="kx-mapsvg" viewBox="0 0 600 480" preserveAspectRatio="xMidYMid slice"><rect width="600" height="480" class="bgr"/>' + ct +
      '<path class="rv" d="M-10 200 C80 230 120 150 200 190 S300 260 360 230 S480 120 620 150"/>' +
      '<g class="cmp" transform="translate(560 440)"><circle r="14"/><path d="M0 -10 4 2 0 0 -4 2z"/><text y="-18" text-anchor="middle">N</text></g>' +
      '<path class="rd" d="' + route + '"/><path class="rdi" d="' + route + '"/><path class="rdc" d="' + route + '"/><path class="trail" d="' + route + '"/>' + extra +
      '<line class="gl" x1="0" y1="0" x2="0" y2="0"/>' +
      riders.map((r, i) => '<g class="rdr' + (i === 1 ? ' me' : '') + '" data-i="' + i + '"><circle class="halo" r="17"/><circle r="11.5" fill="' + r[2] + '"/><text y="4.5" text-anchor="middle">' + (i + 1) + '</text><text class="nm"' + (i % 2 ? ' x="-16" y="24" text-anchor="end"' : ' x="16" y="-12"') + '>' + TS(r[3][0], r[3][1]) + '</text></g>').join('') + '</svg>';
  }
  const fmtT = s => { const m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1); };
  /* live ranking along the route */
  const RANK_A = [.35,.31,.26,.21,.15], RANK_B = [.62,.68,.26,.55,.50], KM = 10.34;
  function rankRun(k, dur) {
    const path = k.q('.rd'); if (!path) return;
    const L = path.getTotalLength(), g = k.qa('.rdr'), rows = k.qa('.kx-lb .row'), trail = k.q('.trail'), gl = k.q('.gl'), tag = k.q('.kx-gaptag'), host = k.host;
    const svgEl = k.q('.kx-mapsvg');
    let previousLeader;
    trail.style.strokeDasharray = L; 
    k.anim(dur, r => {
      const s = RANK_A.map((a, i) => a + (RANK_B[i] - a) * r);
      const pts = s.map(v => path.getPointAtLength(L * v));
      g.forEach((e, i) => e.setAttribute('transform', 'translate(' + pts[i].x.toFixed(1) + ' ' + pts[i].y.toFixed(1) + ')'));
      trail.style.strokeDashoffset = L * (1 - Math.max(...s));
      const order = s.map((v, i) => i).sort((a, b) => s[b] - s[a]);
      if (previousLeader !== undefined && previousLeader !== order[0]) k.fx('rank');
      previousLeader = order[0];
      order.forEach((ri, pos) => { const row = rows[ri]; row.style.top = (24 + pos * 30) + 'px'; row.querySelector('em').textContent = pos === 0 ? (isEn() ? 'Leader' : '领队') : '+' + ((s[order[0]] - s[ri]) * KM).toFixed(1) + ' km'; row.classList.toggle('lead', pos === 0); });
      const ahead = order[order.indexOf(2) - 1];
      if (ahead !== undefined) {
        gl.setAttribute('x1', pts[2].x); gl.setAttribute('y1', pts[2].y); gl.setAttribute('x2', pts[ahead].x); gl.setAttribute('y2', pts[ahead].y);
        tag.querySelector('b').textContent = (isEn() ? '' : '落后前车 ') + ((s[ahead] - s[2]) * KM).toFixed(1) + ' km' + (isEn() ? ' behind' : '');
        const m = svgEl.getScreenCTM(), hr = host.getBoundingClientRect();
        if (m) { const p = svgEl.createSVGPoint(); p.x = pts[2].x; p.y = pts[2].y; const q = p.matrixTransform(m); tag.style.left = (q.x - hr.left) + 'px'; tag.style.top = (q.y - hr.top) + 'px'; }
      }
    });
  }
  /* segment race */
  const RACE = [[.97,1.0],[.93,.85],[1.0,.95],[.90,1.3],[1.04,1.1]], RACE_MS = 4400, RACE_X = 45;
  function countBeat(k, value, rescue) {
    const digit = k.q('[data-c=cd]');
    if (!digit) return;
    digit.textContent = value;
    if (rescue) k.css('.kx-ask .fg', 'strokeDashoffset', String(340 * (15 - value) / 15));
    if (digit.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      digit.animate([{transform:'scale(1.19)'}, {transform:'scale(1)'}], {duration:240, easing:'cubic-bezier(.18,.75,.25,1)'});
    }
    k.fx('count' + value);
  }
  function raceInit(k) {
    const path = k.q('.rd'); if (!path) return;
    const L = path.getTotalLength();
    const perp = (v, cls, lbl, off) => { const a = path.getPointAtLength(L * v), b = path.getPointAtLength(Math.min(L, L * v + 1)), c = path.getPointAtLength(Math.max(0, L * v - 1)); const dx = b.x - c.x, dy = b.y - c.y, n = Math.hypot(dx, dy) || 1, nx = -dy / n, ny = dx / n; const ln = k.q(cls); ln.setAttribute('x1', a.x + nx * 20); ln.setAttribute('y1', a.y + ny * 20); ln.setAttribute('x2', a.x - nx * 20); ln.setAttribute('y2', a.y - ny * 20); const t = k.q(lbl); t.setAttribute('x', a.x); t.setAttribute('y', a.y + off); };
    perp(0, '.sl', '.lbl.s', 42); perp(1, '.fl', '.lbl.f', -30); perp(.5, '.spl', '.lbl.m', -30);
    k.qa('.rdr').forEach((e, i) => { const p = path.getPointAtLength(0); e.setAttribute('transform', 'translate(' + (p.x - 8 + i * 4) + ' ' + (p.y + (i - 2) * 9) + ')'); });
  }
  function raceRun(k) {
    const path = k.q('.rd'); if (!path) return;
    const L = path.getTotalLength(), g = k.qa('.rdr'), tm = k.q('[data-c=tm]'), rows = k.q('.kx-splits .rows'), trail = k.q('.trail');
    trail.style.strokeDasharray = L;
    const split = RACE.map(([f, p]) => f * Math.pow(.5, 1 / p)), so = split.map((v, i) => i).sort((a, b) => split[a] - split[b]);
    const done = new Set(); let shown = 0, accelerating = false;
    const total = Math.max(...RACE.map(r => r[0]));
    k.anim(RACE_MS * total, (r, ms) => {
      const t = ms / RACE_MS;
      tm.textContent = fmtT(Math.min(t, total) * RACE_MS / 1000 * RACE_X);
      let lead = 0;
      RACE.forEach(([f, p], i) => {
        const s = Math.min(1, Math.pow(Math.min(t / f, 1), p)); lead = Math.max(lead, s);
        if (i === 1 && s >= .24 && !accelerating) {
          accelerating = true;
          g[i].classList.add('sprinting');
          k.fx('sprint');
        }
        if (s >= 1 && !done.has(i)) {
          done.add(i); g[i].classList.add('fin'); g[i].dataset.fo = done.size - 1;
          if (i === 1) {
            g[i].classList.remove('sprinting');
            k.add('.kx-race .fl','crossed');
            k.fx('finish');
            k.hud('flag',['冲线 · 第 2 名 · 3:04.1','Finish · 2nd · 3:04.1'],['冠军 阿哲 2:58.2','Winner A-Zhe 2:58.2'],'');
          }
        }
        const a = path.getPointAtLength(L * s);
        g[i].setAttribute('transform', 'translate(' + (s >= 1 ? a.x + 30 : a.x) + ' ' + (s >= 1 ? a.y - 40 + (+g[i].dataset.fo) * 25 : a.y) + ')');
      });
      trail.style.strokeDashoffset = L * (1 - lead);
      while (shown < 3 && t >= split[so[shown]]) {
        const i = so[shown], d = (split[i] - split[so[0]]) * RACE_MS / 1000 * RACE_X;
        rows.insertAdjacentHTML('beforeend', '<div class="' + (i === 1 ? 'me' : '') + '"><b style="background:' + RIDERS[i][2] + '">' + (i + 1) + '</b><span>' + esc(isEn() ? RIDERS[i][3][1] : RIDERS[i][3][0]) + '</span><em>' + (shown ? '+' + d.toFixed(1) + ' s' : fmtT(split[i] * RACE_MS / 1000 * RACE_X)) + '</em></div>');
        shown++; k.add('.kx-splits', 'on');
      }
    });
  }
  function podium(k) {
    const fin = RACE.map((r, i) => i).sort((a, b) => RACE[a][0] - RACE[b][0]).slice(0, 3);
    const col = (i, pl) => '<div class="c p' + pl + '"><span class="av" style="background:' + RIDERS[i][2] + '">' + (i + 1) + '</span><b>' + esc(isEn() ? RIDERS[i][3][1] : RIDERS[i][3][0]) + '</b><small>' + fmtT(RACE[i][0] * RACE_MS / 1000 * RACE_X) + '</small><i>' + pl + '</i></div>';
    k.html('.kx-podium .pd', col(fin[1], 2) + col(fin[0], 1) + col(fin[2], 3));
  }
  function bubble(k, side, who, txt, sub) {
    const b = k.q('.kx-bub.' + side); if (!b) return;
    k.qa('.kx-bub').forEach(e => e.classList.toggle('dim', e !== b && e.classList.contains('on')));
    k.fx('radio');b.querySelector('.who').innerHTML = TT(who); b.querySelector('p').innerHTML = TT(txt); b.querySelector('small').innerHTML = TT(sub);
    b.classList.remove('on', 'dim'); void b.offsetWidth; b.classList.add('on');
    k.qa('.kx-ring3').forEach((e, i) => e.classList.toggle('on', (i === 0) === (side === 'l')));
  }
  const OTH = () => [0, 2, 3, 4].map(i => RIDERS[i]);

  /* ---------- demo scripts ---------- */
  const say = (w, a, b) => k => k.say(w, [a, b]);
  const KB = {
    start: {s:['打不着火怎么办','Bike won\'t start?'], q:['你好骑士，打不着火怎么办？','Hey Knight, the bike won\'t start. What now?'], a:['先看熄火开关和边撑开关，再听启动声判断电瓶。','Check the kill switch and side-stand switch, then listen to the starter to judge the battery.']},
    tire: {s:['扎胎了怎么办','Flat tire?'], q:['你好骑士，好像扎胎了怎么办？','Hey Knight, I think I have a flat. What now?'], a:['先别急着拔钉。打双闪靠边，到安全地点再处理。','Don\'t pull the nail yet. Hazards on, pull over, fix it somewhere safe.']},
    chain: {s:['链条异响怎么办','Chain rattling?'], q:['你好骑士，链条一直响怎么办？','Hey Knight, my chain keeps rattling. What now?'], a:['多半是缺油或松紧不对。先看下垂量，再补链条油。','Usually dry or wrong tension. Check the slack, then lube it.']},
    altitude: {s:['高原车没劲怎么办','Weak at altitude?'], q:['你好骑士，上了高原车没劲怎么办？','Hey Knight, the bike feels weak at altitude. What now?'], a:['高原动力下降很常见。放慢节奏、提前降挡爬坡。','Power drops at altitude. Slow down and downshift early on climbs.']},
    rain: {s:['雨天怎么过弯','Rain cornering?'], q:['你好骑士，下雨了弯道怎么骑？','Hey Knight, how do I corner in the rain?'], a:['入弯前完成减速，压弯角度比平时小，避开井盖和标线。','Brake before the corner, lean less, avoid manholes and road paint.']}
  };
  const hazardCues = {
  "碎石": {
    "request": [
      "你好骑士，标记前方碎石",
      "Hey Knight, mark loose gravel ahead"
    ],
    "receipt": [
      "碎石已标记",
      "Loose gravel marked"
    ]
  },
  "暗冰积水": {
    "request": [
      "你好骑士，标记前方暗冰积水",
      "Hey Knight, mark black ice and standing water ahead"
    ],
    "receipt": [
      "暗冰积水已标记",
      "Black ice and standing water marked"
    ]
  },
  "大车淋水": {
    "request": [
      "你好骑士，标记前方大车淋水",
      "Hey Knight, mark truck spray ahead"
    ],
    "receipt": [
      "大车淋水已标记",
      "Truck spray marked"
    ]
  },
  "落石": {
    "request": [
      "你好骑士，标记前方落石",
      "Hey Knight, mark rockfall ahead"
    ],
    "receipt": [
      "落石已标记",
      "Rockfall marked"
    ]
  },
  "深泥": {
    "request": [
      "你好骑士，标记前方深泥",
      "Hey Knight, mark deep mud ahead"
    ],
    "receipt": [
      "深泥已标记",
      "Deep mud marked"
    ]
  }
};
  function selectedHazard() {
    const choice = document.querySelector('#demo-p3 [data-p3-choice]');
    return (choice && hazardCues[choice.value]) || hazardCues['碎石'];
  }
  const P3 = {
    dropoff: {l:['队友掉队','Teammate falls behind'], run:[
      [0,k=>{k.step(1);k.flash('red');k.buzz();k.fx('caution');k.hud('users',['03 号车掉队','Bike 03 fell behind'],['落后领队 1.5 km','1.5 km behind the leader'],'red');}],
      [1500,k=>{k.step(2);k.say('knight',['03 号车落后 1.5 km，已提醒领队。','Bike 03 is 1.5 km behind; leader notified.']);}],
      [2900,k=>{k.click('#demo-p3 .p3-trigger');k.fx('route');k.voice('集合点已设置，路线已发给全队。');k.hud('flag',['集合点已设置','Meetup set'],['全队同步导航','Whole crew navigates there'],'green');}],
      [4100,k=>k.out(['掉队第一时间发现，不再一回头人没了','Stragglers spotted at once; nobody quietly lost'])]]},
    sos: {l:['队友遇险','Teammate in trouble'], run:[
      [0,k=>{k.step(1);k.flash('red');k.buzz();k.fx('sos');k.hud('sos',['03 号车发出 SOS','Bike 03 sent SOS'],['队友可查看求助位置 · 此页不联系救援','Crew SOS location · no emergency call placed'],'red');}],
      [1600,k=>{k.step(2);k.click('#demo-p3 .p3-trigger');k.fx('route');k.say('knight',['三号车遇险，四号车已收到返回路线。','Bike 03 needs help; bike 04 has a route back.']);}],
      [4300,k=>k.out(['一人遇险，全队马上知道、就近支援','One rider in trouble: the crew knows at once and the nearest helps'])]]},
    hazard: {l:['语音标记前方路况','Mark a road hazard by voice'], run:[
      [0,k=>{k.step(1);k.say('rider',selectedHazard().request);}],
      [1500,k=>{k.step(2);k.click('#demo-p3 .p3-trigger');k.fx('stamp');k.hud('alert',selectedHazard().receipt,['后车靠近时自动预警','Riders behind warned on approach'],'');}],
      [2300,k=>k.say('knight',['路况已标记，后方队友将收到提醒。','Hazard marked; riders behind will be warned.'])],
      [4100,k=>k.out(['前车看到的危险，后车提前知道','What the front rider sees, riders behind know in advance'])]]},
    call: {l:['高速限通话','Talk limit at speed'], run:[
      [0,k=>{k.step(1);k.flash('amber');k.hud('alert',['68 km/h · 通话已收起','68 km/h · talk folded'],['只保留一键预警，消息转为播报','One-tap alerts only; messages read aloud'],'');}],
      [1300,k=>{k.step(2);k.say('knight',['车速较快，队内语音已转为播报。','Riding fast: crew voice switched to read-outs.']);}],
      [3300,k=>{k.sayOff();k.click('#demo-p3 .p3-trigger');k.fx('radio');k.voice('已接通领队。');k.hud('phone',['降到 25 km/h · 通话恢复','Down to 25 km/h · talk restored'],['已接通领队','Connected to the leader'],'green');}],
      [4600,k=>k.out(['骑得快时自动收起通话，注意力留给路面','At speed, calls fold away and attention stays on the road'])]]},
    offline: {l:['无信号直连','Dead-zone link'], run:[
      [0,k=>{k.step(1);k.fx('offline');k.hud('alert',['蜂窝信号中断','Cell signal lost'],['山区无网路段','Mountain dead zone'],'red');}],
      [1500,k=>{k.step(2);k.fx('link');k.hud('users',['已切换眼镜直连','Switched to glasses link'],['位置与告警逐车接力','Positions and alerts relay bike to bike'],'green');k.say('knight',['无信号，已切换眼镜直连。','No signal: switched to glasses-to-glasses link.']);}],
      [3500,k=>{k.sayOff();k.click('#demo-p3 .p3-trigger');k.fx('online');k.voice('网络已恢复，离线消息已同步。');k.hud('check',['网络恢复','Signal back'],['离线报文已补传','Queued alerts uploaded'],'green');}],
      [4700,k=>k.out(['没有信号，队内照样互通','No signal, and the crew still stays connected'])]]},
    fuel: {l:['油量告急','Low fuel'], run:[
      [0,k=>{k.step(1);k.flash('amber');k.fx('caution');k.hud('alert',['02 号车油量 18%','Bike 02 fuel at 18%'],['前方 12 km 有加油站','Gas station 12 km ahead'],'red');}],
      [1300,k=>{k.step(2);k.click('#demo-p3 .p3-trigger');}],
      [2000,k=>{k.click('#demo-p3 .p3-broadcast');k.fx('send');k.say('knight',['二号车油量百分之十八，全队在镇口加油站集结。','Bike 2 fuel at 18%. Crew, regroup at the town gas station.']);}],
      [4200,k=>k.out(['补给集结一句话搞定，没人半路没油','Refuel meetups in one sentence; nobody runs dry'])]]}
  };
  const D = {
    'p1:brake': [{l:['前车急刹','Car ahead brakes'], scene:'brake', run:[
      [0,k=>{k.step(1);k.ph(1);k.host.style.setProperty('--approach-time','1.1s');k.zoom(1.12);k.fx('approach');k.count('.kx-ret b',42,25,1100,0,' m');k.css('.kx-gapbar i','--g','62%');}],
      [1150,k=>{k.ph(2);k.host.style.setProperty('--approach-time','.45s');k.zoom(1.3);k.fx('brake');k.count('.kx-ret b',25,18,600,0,' m');k.css('.kx-gapbar i','--g','22%');}],
      [1450,k=>{k.step(2);k.flash('red');k.buzz();k.fx('alert');k.hud('alert',['前车急刹','Car ahead braking'],['车距 18 m · 请减速','Gap 18 m · slow down'],'red');}],
      [2050,say('knight','前车急刹，注意车距。','Car ahead braking. Watch your distance.')],
      [3700,k=>{k.step(3);k.ph(3);k.host.style.setProperty('--approach-time','.85s');k.zoom(1.08);k.fx('release');k.count('.kx-ret b',18,32,900,0,' m');k.css('.kx-gapbar i','--g','66%');k.hud('check',['车距恢复','Gap restored'],['已减速 · 安全跟车','Slowed down · safe distance'],'green');}],
      [4400,k=>k.out(['提前一步提醒，留出刹车距离','Warned a beat earlier, with room to brake'])]]}],
    'p1:tire': [{l:['胎压骤降','Tire pressure drops'], scene:'tire', run:[
      [0,k=>{k.step(1);k.ph(1);k.fx('progress');k.count('[data-c=p]',2.3,1.1,2000,1);k.count('[data-c=t]',42,68,2000);k.css('.kx-meter i','--m','38%');}],
      [2100,k=>{k.step(2);k.ph(2);k.flash('amber');k.buzz();k.fx('caution');k.hud('tire',['后轮胎压偏低','Rear tire pressure low'],['1.1 bar · 68°C · 仍在上升','1.1 bar · 68°C · rising'],'red');}],
      [2700,say('knight','后轮胎压偏低，建议在下个服务区停车检查。','Rear tire pressure low. Check it at the next rest stop.')],
      [4600,k=>{k.step(3);k.ph(3);k.fx('route');k.hud('nav',['已导航到最近服务区','Routed to the next rest stop'],['慢速前往 · 检查补气','Ride slowly · check and inflate'],'green');}],
      [5200,k=>k.out(['慢漏气也能及时发现，避免高速爆胎','Slow leaks caught early, before a blowout'])]]}],
    'p1:body': [{l:['疲劳提醒','Fatigue alert'], scene:'body', run:[
      [0,k=>{k.step(1);k.ph(1);k.count('[data-c=hr]',80,84,2400);}],
      [1700,k=>{k.step(2);k.ph(2);k.flash('amber');k.buzz();k.fx('caution');k.hud('alert',['该休息了','Time for a break'],['已连续骑行 3 h · 昨晚睡眠 5.2 h','3 h riding · slept 5.2 h last night'],'');}],
      [2300,say('knight','已经连续骑行三小时了，前方 8 公里有休息区，歇一会儿再走。','Three hours in the saddle. Rest area 8 km ahead; take a break.')],
      [3600,k=>k.buzz()],
      [4700,k=>{k.step(3);k.ph(3);k.sayOff();k.fx('pin');k.hud('pin',['前方休息区 · 8 km','Rest area · 8 km ahead'],['已加入导航','Added to your route'],'green');}],
      [5900,k=>k.out(['犯困之前就提醒休息，不再硬撑','A rest prompt before drowsiness, no more pushing on'])]]}],
    'p1:altitude': [{l:['高原提醒','Altitude alert'],run:[
      [0,k=>{k.step(1);k.zoom(1.04);k.hud('pin',['海拔 4,520 m','Altitude 4,520 m'],['折多山垭口','Zheduo Pass'],'');}],
      [1250,k=>{k.step(2);k.fx('caution');k.hud('alert',['高海拔路段','High-altitude stretch'],['留意身体状况','Check how you feel'],'');}],
      [2050,k=>{k.voice('你已到达高海拔路段，心率偏高，放慢节奏，记得补水。');}],
      [4400,k=>{k.step(3);k.out(['海拔和健康记录已同步','Altitude and health readings synced']);}]]}],
    'p1:weather': [{l:['天气路况','Weather and road'],run:[
      [0,k=>{k.step(1);k.hud('nav',['前方山路','Mountain road ahead'],['沿途天气更新','Route weather updated'],'');}],
      [1350,k=>{k.step(2);k.fx('caution');k.hud('alert',['前方阵雨','Rain ahead'],['弯道路面可能湿滑','Bends may be slippery'],'');}],
      [2050,k=>{k.voice('前方有阵雨，弯道路面可能湿滑。');}],
      [4000,k=>{k.step(3);k.out(['降雨提醒已送达眼镜','Rain alert delivered to the glasses']);}]]}],
    'p1:fall': [{l:['摔车求助','Crash SOS'], scene:'fall', run:[
      [0,k=>{k.step(1);k.ph(1);k.fx('impact');k.shake();k.flash('red');k.buzz();}],
      [600,k=>k.hud('crash',['检测到摔车','Crash detected'],['剧烈冲击 · 姿态突变 · 已停止移动','Hard impact · sudden tilt · not moving'],'red')],
      [1900,k=>{k.step(2);k.ph(2);k.hudOff();k.anim(1700,r=>{const value=15-Math.floor(r*11);k.text('[data-c=cd]',value);k.css('.kx-ask .fg','strokeDashoffset',String(340*(15-value)/15));});k.say('knight',['你还好吗？没有回应将自动求救。','Are you OK? No reply and I\'ll call for help.']);}],
      [4000,k=>{k.ph(3);k.sayOff();countBeat(k,3,true);}],
      [5000,k=>countBeat(k,2,true)],
      [6000,k=>countBeat(k,1,true)],
      [7000,k=>{k.text('[data-c=cd]','0');k.step(3);k.ph(4);k.flash('red');k.fx('sos');k.voice('求救已发出，你的位置已共享。');k.hud('sos',['SOS 回执示例','Example SOS receipt'],['位置随求助卡共享 · 此页不联系救援','Location on SOS card · no emergency call placed'],'red');}],
      [8500,k=>{k.hudOff();k.out(['摔车后来不及掏手机，也能自动求救','Help is called even when you can\'t reach your phone']);}]]}],
    'p5:wake': [
      {l:['微信播报','WeChat read-out'], pre:k=>k.click('#demo-p5 [data-command="wechat"]'), scene:'msg', run:[
        [0,k=>{k.step(1);k.fx('message');k.ph(1);k.flash('amber');k.buzz();}],
        [800,k=>{k.step(2);k.say('knight',['老王发来微信：到哪了？垭口等你。','WeChat from Lao Wang: Where are you? Waiting at the pass.']);}],
        [3400,k=>{k.step(3);k.out(['消息不用看，耳边就能听','Messages read to you, no screen needed']);}]]},
      {l:['语音回复','Voice reply'], pre:k=>k.click('#demo-p5 [data-command="reply"]'), scene:'msg', run:[
        [0,k=>{k.step(1);k.ph(1);k.say('rider',['你好骑士，回复老王：二十分钟到','Hey Knight, reply to Lao Wang: 20 minutes away']);}],
        [2000,k=>{k.step(2);k.ph(2);k.sayOff();k.fx('sync');k.voice('已回复老王。');k.hud('check',['已回复老王','Replied to Lao Wang'],['语音转文字 · 已发送','Voice to text · sent'],'green');}],
        [3500,k=>{k.step(3);k.out(['双手不离把，开口就能回','Hands on the bars, reply by voice']);}]]},
      {l:['接听来电','Answer a call'], pre:k=>k.click('#demo-p5 [data-command="call"]'), scene:'msg', run:[
        [0,k=>{k.step(1);k.fx('incoming');k.ph(3);k.flash('amber');k.buzz();}],
        [600,k=>{k.step(2);k.say('knight',['妈妈来电，要接听吗？','Mom is calling. Answer?']);}],
        [2100,k=>k.say('rider',['你好骑士，接听','Hey Knight, answer'])],
        [3200,k=>{k.ph(4);k.fx('radio');k.html('[data-c=cs]',T('已接通 · 风噪过滤开启','Connected · wind noise filtered'));k.sayOff();k.step(3);k.hud('phone',['通话中','On a call'],['骨传导播放 · 不堵耳朵','Bone conduction · ears stay open'],'green');}],
        [4000,k=>k.out(['来电不错过，也不用掏手机','Never miss a call, never reach for the phone'])]]},
      {l:['问加油站','Find gas'], pre:k=>k.click('#demo-p5 [data-command="ask"]'), scene:'gas', run:[
        [0,k=>{k.step(1);k.say('rider',['你好骑士，最近的加油站在哪？','Hey Knight, where\'s the nearest gas station?']);}],
        [1700,k=>{k.step(2);k.ph(1);k.sayOff();k.fx('route');k.hud('nav',['已导航 · 镇口加油站','Routing · town gas station'],['路线已投到镜片','Route shown in the lens'],'');}],
        [2400,say('knight','前方十二公里镇口有加油站，已为你导航。','Gas station in town, 12 km ahead. Routing you there.')],
        [4400,k=>{k.step(3);k.out(['找加油站，不用停车翻地图','Find fuel without stopping to check a map']);}]]},
      {l:['识别地标','Identify a landmark'], pre:k=>k.click('#demo-p5 [data-command="vision"]'), scene:'mark', run:[
        [0,k=>{k.step(1);k.say('rider',['你好骑士，山上那座建筑是什么？','Hey Knight, what\'s that building on the hill?']);}],
        [1600,k=>{k.step(2);k.ph(1);k.sayOff();k.fx('radar');}],
        [2400,k=>{k.ph(2);k.fx('found');k.say('knight',['这是沿途的一座古寺，简介和照片已存入今日生活库。','A temple along the route; notes and a photo are saved to today\'s log.']);}],
        [4700,k=>{k.step(3);k.out(['看到什么问什么，沿途风景有人讲','Ask about anything you see along the way']);}]]},
      {l:['拍一张','Take a photo'], pre:k=>k.click('#demo-p5 [data-command="photo"]'), scene:'photo', run:[
        [0,k=>{k.step(1);k.say('rider',['你好骑士，拍一张','Hey Knight, take a photo']);}],
        [1300,k=>{k.step(2);k.sayOff();k.fx('shutter');k.flash('white');k.ph(1);}],
        [2500,k=>{k.ph(2);k.voice('拍好了，已存入今天的生活库。');k.hud('camera',['已拍摄','Photo taken'],['附坐标与海拔 · 存入今日生活库','With GPS & altitude · saved to today\'s log'],'green');}],
        [3700,k=>{k.step(3);k.out(['最美的一刻，开口就能拍','Catch the moment just by saying so']);}]]}],
    'p2:group': [
      {l:['附近摩友','Riders nearby'], scene:k=>SC.group(k,'radar'), run:[
        [0,k=>{k.step(1);k.ph(1);k.fx('radar');k.qa('.kx-radar .pt').forEach((point,i,points)=>k.later(400+i*420,()=>{
            point.classList.add('on');
            if(i===0 || i===points.length-1)k.fx('found');
          }));}],
        [500,k=>k.count('[data-c=n]',0,4,1500)],
        [2400,k=>{k.step(2);k.ph(2);k.voice('找到四位摩友，已发出邀请。');k.stagger('.kx-phone .mem li',220);}],
        [3500,k=>{k.ph(3);k.qa('.kx-phone .mem li').forEach((e,i)=>k.later(i*260,()=>e.classList.add('ok')));}],
        [4700,k=>{k.ph(4);k.fx('joined');k.buzz();k.say('knight',['已加入车队，五人到齐。','You\'re in the crew. All five here.']);}],
        [6200,k=>{k.step(3);k.out(['附近的摩友，一下就能组成车队','Riders nearby become a crew in seconds']);}]]},
      {l:['面对面建群','Face-to-face'], scene:k=>SC.group(k,'code'), run:[
        [0,k=>{k.step(1);k.ph(1);k.voice('面对面组队，口令是二六一八。');['2','6','1','8'].forEach((d,i)=>k.later(300+i*380,()=>{const ds=k.qa('.kx-phone .dg span');ds[i]&&ds[i].classList.add('on');const kb=k.q('.kx-phone .kp [data-k="'+d+'"]');if(kb){k.fx('hotspot');kb.classList.remove('hit');void kb.offsetWidth;kb.classList.add('hit');}}));}],
        [2000,k=>{k.step(2);k.ph(2);k.stagger('.kx-phone .mem li',260);}],
        [2400,k=>k.qa('.kx-phone .mem li').forEach((e,i)=>k.later(300+i*260,()=>e.classList.add('ok')))],
        [3900,k=>{k.ph(4);k.fx('joined');k.buzz();k.say('knight',['已加入车队，五人到齐。','You\'re in the crew. All five here.']);}],
        [5400,k=>{k.step(3);k.out(['面对面输个数字，全队自动进群','Same four digits, the whole crew joins']);}]]}],
    'p2:rank': [{l:['实时位置与排名','Live positions'], scene:'rank', run:[
      [0,k=>{k.step(1);k.ph(1);rankRun(k,6400);}],
      [2200,k=>{k.step(2);k.flash('amber');k.say('knight',['你已超过老王，升至第一。','You passed Lao Wang. You\'re now first.']);}],
      [3900,k=>{k.ph(2);k.sayOff();k.buzz();k.fx('caution');k.voice('老周落后一点二公里，已提醒领队。');k.hud('users',['3 号 老周 · 落后前车 1.2 km','#3 Lao Zhou · 1.2 km behind'],['已提醒领队放慢','Leader asked to ease off'],'red');}],
      [6300,k=>{k.step(3);k.hudOff();k.out(['全队在哪、谁领先、谁掉队，一眼看清','Who\'s where, who leads, who\'s dropping back, at a glance']);}]]}],
    'p2:challenge': [{l:['路段竞速','Segment race'], scene:'race', run:[
      [0,k=>{k.step(1);k.ph(1);raceInit(k);countBeat(k,3,false);}],
      [850,k=>countBeat(k,2,false)],
      [1700,k=>countBeat(k,1,false)],
      [2550,k=>{k.html('[data-c=cd]',T('出发','GO'));k.fx('go');k.flash('green');raceRun(k);}],
      [2880,k=>k.ph(2)],
      [4360,k=>{k.step(2);k.say('knight',['分段一：你暂列第一。','Split 1: you\'re in first.']);}],
      [6730,k=>{k.sayOff();k.voice('你已冲线，本段第二名。');}],
      [7950,k=>{k.step(3);k.ph(3);k.hudOff();k.fx('medal3');podium(k);}],
      [8750,k=>k.out(['选一段路就是赛道：自动计时、分段播报、冲线出榜','Any stretch becomes a track: timing, splits and a podium'])]]}],
    'p2:greet': [{l:['同路语音转译','Ride-along voice'], scene:'greet', run:[
      [0,k=>{k.step(1);k.fx('found');k.hud('users',['同路雷达','Ride radar'],['前方 200 m · 同向车队','Crew 200 m ahead · same way'],'');}],
      [700,k=>{k.hudOff();k.voice('前面的朋友，也去新都桥吗？');bubble(k,'l',['我','ME'],['前面的朋友，也去新都桥吗？','Hey up ahead, heading to Xinduqiao too?'],['语音 → 已送达对方眼镜','Voice → delivered to their glasses']);}],
      [2400,k=>{k.step(2);k.voice('是啊！我们在垭口等日落。');bubble(k,'r',['前方车队','CREW AHEAD'],['是啊！我们在垭口等日落。','Yes! Waiting for sunset at the pass.'],['对方语音 · 实时转字幕','Their voice · live captions']);}],
      [4100,k=>{k.voice('前面两公里有碎石，慢点骑。');bubble(k,'l',['我','ME'],['前面两公里有碎石，慢点骑。','Loose gravel 2 km on, take it easy.'],['语音 → 已送达对方眼镜','Voice → delivered to their glasses']);}],
      [5800,k=>{k.voice('收到，谢谢！垭口见！');bubble(k,'r',['前方车队','CREW AHEAD'],['收到，谢谢！垭口见！','Got it, thanks! See you at the pass!'],['对方语音 · 实时转字幕','Their voice · live captions']);}],
      [7500,k=>{k.step(3);k.qa('.kx-bub').forEach(e=>e.classList.add('dim'));k.out(['同路的摩友，开口就能聊上','Talk with riders on the same road, just by speaking']);}]]}],
    'p2:awards': [{l:['骑行高光榜','Ride highlights'], scene:'awards', run:[
      [0,k=>{k.step(1);k.ph(1);k.fx('tally');k.count('[data-c=s1]',0,286,1500);k.count('[data-c=s2]',0,3120,1500);k.count('[data-c=s3]',0,146,1500);k.count('[data-c=s4]',0,5,1500);}],
      [1800,k=>{k.step(2);k.ph(2);const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        k.qa('.kx-awd .cards li').forEach((row, index) => k.later(index * 650, () => {
          const sound = () => k.fx(['medal1','medal2','medal3','medal4'][index]);
          if (!reducedMotion) row.querySelector('.bdg').addEventListener('animationstart', sound, {once:true});
          row.classList.add('on');
          if (reducedMotion) sound();
        }));}],
      [4700,k=>{k.ph(3);k.fx('sync');k.say('knight',['今日高光榜已生成，已分享到车队群。','Today\'s highlights are ready and shared to the crew chat.']);}],
      [6600,k=>{k.step(3);k.out(['收车就有全队高光榜，晒出去带来新摩友','Crew highlights at day\'s end; sharing brings new riders']);}]]}],
    'p5:hud': [{l:['说：导航去新都桥','Say: navigate to Xinduqiao'], scene:'route', run:[
      [0,k=>{k.step(1);k.say('rider',['你好骑士，导航去新都桥','Hey Knight, navigate to Xinduqiao']);}],
      [1500,k=>{k.step(2);k.ph(1);k.fx('route');k.hud('nav',['路线已规划','Route ready'],['新都桥 · 语音导航中','Xinduqiao · voice guidance'],'');}],
      [2600,k=>{k.ph(2);k.hudOff();k.count('[data-c=d]',600,300,1200);k.css('.kx-vol .kx-meter i','--v','18%');k.text('[data-c=v]','18%');k.say('knight',['前方三百米，连续右弯，请留意路况。','Right-hand curves in 300 m. Watch the road.']);}],
      [4500,k=>{k.step(3);k.ph(3);k.css('.kx-vol .kx-meter i','--v','76%');k.text('[data-c=v]','76%');k.sayOff();}],
      [4900,k=>k.out(['不用低头看手机，路线在眼前、音乐在耳边','No glancing down: route in view, music in your ear'])]]}],
    'p5:vlog': [{l:['一键生成 Vlog','Make today\'s Vlog'], scene:'vlog', run:[
      [0,k=>{k.step(1);k.ph(1);k.hud('film',['自动记录中','Auto-recording'],['AI 识别高光并打标','AI tags the highlights'],'');k.stagger('.kx-tile',350,'card');}],
      [1900,k=>{k.step(2);k.ph(2);k.hudOff();k.fx('progress');k.css('.kx-screen .kx-meter i','--m','100%');}],
      [3600,k=>{k.step(3);k.ph(3);k.fx('sync');k.html('[data-c=vt]',T('今日 Vlog','Today\'s Vlog'));k.say('knight',['今天的 Vlog 和手帐已生成，要看看吗？','Today\'s vlog and journal are ready. Take a look?']);}],
      [4800,k=>k.out(['到家就有成片和手帐，不用自己剪','Home to a finished film and journal, no editing'])]]}],
    'p5:checkin': [
      {l:['到达打卡点','Reach a check-in spot'], scene:'checkin', run:[
        [0,k=>{k.step(1);k.ph(1);k.css('.kx-prof .done','--pd','170');k.fx('tally');k.dot(.52,1600);k.count('[data-c=alt]',2560,4298,1600);}],
        [1700,k=>{k.step(2);k.fx('stamp');k.flash('white');k.hud('pin',['折多山垭口 · 4,298 m','Zheduo Pass · 4,298 m'],['打卡成功 · 照片已存','Checked in · photo saved'],'green');}],
        [2300,say('knight','折多山打卡完成，照片与坐标已同步。','Zheduo Pass check-in done; photo and location synced.')],
        [3800,k=>{k.step(3);k.ph(2);k.fx('medal2');k.hudOff();k.sayOff();}],
        [4400,k=>k.out(['每一程都有记录和成就，骑得更有动力','Every ride leaves records and badges, so you ride more'])]]},
      {l:['邀请同骑','Invite riders'], scene:'checkin', run:[
        [0,k=>{k.step(1);k.say('rider',['你好骑士，把今天分享给老王他们','Hey Knight, share today with Lao Wang and the crew']);}],
        [1600,k=>{k.step(2);k.ph(3);k.sayOff();k.voice('邀请卡做好了，附上了今天的路线。');k.fx('card');k.hud('users',['邀请卡已生成','Invite card ready'],['附今日路线与高光','With today\'s route & highlights'],'');}],
        [2300,k=>k.stagger('.kx-avs span',350,'send')],
        [3900,k=>{k.step(3);k.out(['一张邀请卡，带来一整支车队','One invite card brings a whole crew']);}]]}],
    'p4:edit': [{l:['一键生成全队成片','Make the crew film'], scene:'feeds', run:[
      [0,k=>{k.step(1);k.stagger('.kx-feed',260,'card');k.hud('film',['四路第一视角素材','Four POV feeds'],['来自全队 4 副眼镜','From the crew\'s 4 glasses'],'');}],
      [1700,k=>{k.step(2);k.hud('spark',['AI 对齐与剪辑','AI aligns and edits'],['按时间与定位对齐','Aligned by time and GPS'],'');k.fx('link');k.addAll('.kx-feed','al');}],
      [2800,k=>{k.fx('sync');k.add('.kx-feeds','merge');k.say('knight',['全队成片已生成。','The crew film is ready.']);}],
      [3700,k=>{k.step(3);k.ph(3);k.css('.kx-feeds','opacity','0');k.hudOff();k.playVideo('#demo-p4 video');}],
      [4100,k=>k.out(['全队多机位，自动剪成一部片','Every rider\'s camera, auto-cut into one film'])]]}],
    'p4:cloud': [{l:['同步今日路书','Sync today\'s roadbook'], scene:'pins', run:[
      [0,k=>{k.step(1);k.add('.kx-pins','on');k.stagger('.kx-pins .kx-tag',550,'pin');}],
      [2400,k=>{k.step(2);k.fx('sync');k.voice('今天的路书已同步到四副眼镜。');k.hud('check',['今日路书 · 已同步 4 副眼镜','Roadbook synced to 4 glasses'],['里程、海拔、照片自动归档','Distance, altitude, photos archived'],'green');}],
      [3800,k=>{k.step(3);k.out(['路线、照片和海拔，自动整理成路书','Routes, photos and altitude, auto-built into a roadbook']);}]]}],
    'p4:snap': [{l:['说：你好骑士，拍一张','Say: take a photo'], scene:'photo', run:[
      [0,k=>{k.step(1);k.say('rider',['你好骑士，拍一张','Hey Knight, take a photo']);}],
      [1300,k=>{k.step(2);k.sayOff();k.fx('shutter');k.flash('white');k.click('#demo-p4 [data-snap]');k.ph(1);}],
      [2600,k=>{k.ph(2);k.voice('拍好了，已存入车队相册。');k.hud('camera',['已存入车队相册','Saved to the crew album'],['附海拔与坐标','With altitude and GPS'],'green');}],
      [3700,k=>{k.step(3);k.out(['双手不离把，也能抓拍最美瞬间','Catch the best moments, hands on the bars']);}]]}],
    'p4:album': [{l:['按地图翻看相册','Browse by map'], scene:'pins', run:[
      [0,k=>{k.step(1);k.add('.kx-pins','on');k.stagger('.kx-pins .kx-tag',500,'pin');}],
      [2200,k=>{k.step(2);k.fx('settle');k.voice('车队照片已按地点整理好了。');k.hud('users',['全队相册','Crew album'],['队友影像按地点自动归集','Teammates\' shots grouped by place'],'');}],
      [3700,k=>{k.step(3);k.out(['全队的照片，按地点自动归到一起','Everyone\'s photos, grouped by place automatically']);}]]}],
    'p6:flow': [{l:['收录骑友经验','Turn posts into know-how'], scene:k=>SC.cards(k,[[['App 发帖 · 川西','App post · W. Sichuan'],['高原车没劲、怠速不稳','Weak power, rough idle at altitude']],[['App 发帖 · 滇西','App post · W. Yunnan'],['雨后山路过弯后轮打滑','Rear slides on wet corners']],[['网络公开案例','Public web case'],['长途后链条异响、跳齿','Chain rattles after long rides']]],['骑行知识库','Riding knowledge base']), run:[
      [0,k=>{k.step(1);k.stagger('.kx-fly .kx-card',380,'card');}],
      [1900,k=>{k.step(2);k.addAll('.kx-fly .kx-card','out');k.add('.kx-node','on');k.fx('medal4');k.add('.kx-node .medal','pulse');}],
      [2400,k=>k.hud('book',['已整理进骑行知识库','Added to the knowledge base'],['按车型、路况、地区归类','By bike, road and region'],'green')],
      [3400,k=>{k.step(3);k.say('knight',['下一位摩友问到，骑士会更快回答。','The next rider who asks gets a faster answer.']);}],
      [4400,k=>k.out(['每一次求助，都在帮下一位摩友','Every question asked helps the next rider'])]]}],
    'p6:fly': [{l:['查看骑行记录的用处','Explore how ride logs help'], run:[
      [0,k=>{k.step(1);if(!document.querySelector('#flywheel.is-spinning,#flywheel .is-spinning'))k.click('#flywheel [data-fly-auto]');k.fx('progress');k.hud('spark',['从行程到提醒','From ride logs to alerts'],['骑行 → 数据 → 更懂你','Ride → data → knows you better'],'');}],
      [2600,k=>{k.step(2);k.say('knight',['你常在下午犯困，今天会提前提醒你休息。','You tend to get drowsy in the afternoon; I\'ll remind you earlier today.']);}],
      [4600,k=>{k.step(3);k.out(['用得越多，骑士越懂你','The more you ride, the better Knight knows you']);}]]}]
  };
  for (const m in P3) D['p3:' + m] = [{l:P3[m].l, run:P3[m].run}];
  for (const q in KB) D['p6:kb:' + q] = [{l:['问：' + KB[q].s[0], 'Ask: ' + KB[q].s[1]], scene:k=>SC.cards(k,[[['社区案例 · 川西','Community case · W. Sichuan'],['已解决 · 摩友补充 3 条','Solved · 3 rider tips']],[['社区案例 · 滇西','Community case · W. Yunnan'],['已解决 · 领队经验','Solved · leader\'s tips']],[['网络公开经验','Public know-how'],['已标注车型','Tagged by model']]]), run:[
    [0,k=>{k.step(1);k.say('rider',KB[q].q);}],
    [1500,k=>{k.step(2);k.sayOff();k.fx('radar');k.add('.kx-scan','on');k.stagger('.kx-fly .kx-card',300);k.hud('chat',['匹配社区相似案例','Matching community cases'],['结合你的车和路况','For your bike and road'],'');}],
    [2900,k=>{k.addAll('.kx-fly .kx-card','out');k.fx('found');k.rm('.kx-scan','on');k.hud('check',['找到 3 条骑友经验','Found 3 rider tips'],['耳边讲给你听','Told in your ear'],'green');}],
    [3300,k=>k.say('knight',KB[q].a)],
    [5400,k=>{k.step(3);k.out(['荒郊无人可问，也能听到摩友的解决办法','Nobody around? Hear how other riders fixed it']);}]]}];

  /* ---------- stage (v7: auto-loop, no buttons) ---------- */
  const LOOP_GAP = 1500;
  const pressed = (sel, attr) => { const b = document.querySelector(sel + '[aria-pressed="true"]'); return b ? b.getAttribute(attr) : ''; };
  const CFG = [
    {route:'p1', host:'#demo-p1 .p1-viewfinder', pan:'.p1-roadphoto', hide:['.p1-overlay'], tabs:'#demo-p1 .feature-tabs', key:()=>'p1:' + pressed('#demo-p1 [data-p1-tab]','data-sensor')},
    {route:'p5', host:'#demo-p5 .p1-viewfinder', pan:'.p1-roadphoto', hide:['.p1-overlay'], tabs:'#demo-p5 .feature-tabs', key:()=>'p5:' + pressed('#demo-p5 [data-p1-tab]','data-p1-tab')},
    {route:'p2', host:'#demo-p2 .p2-display', light:1, hide:['.p2-photo-note','.p2-screen-top','.p2-radar','.p2-glance','.p2-climb','.p2-invite .phone','.p2-invite .pov-hud'], tabs:'#demo-p2 .feature-tabs', key:()=>'p2:' + pressed('#demo-p2 [data-p2-tab]','data-p2-tab')},
    {route:'p3', host:'#demo-p3 .p3-map', light:1, hide:['.p3-map-bottom','.p3-map-top'], tabs:'#demo-p3 .feature-tabs', pre:()=>{ if (window.__p3reset) window.__p3reset(); }, key:()=>'p3:' + pressed('#demo-p3 [data-p3-mode]','data-p3-mode')},
    {route:'p4', host:'#demo-p4 .rec-screen', pan:'.rec-still', light:1, hide:['.rec-onscreen'], tabs:'#demo-p4 .feature-tabs', key:()=>'p4:' + pressed('#demo-p4 [data-rec-tab]','data-rec-tab')},
    {route:'p6', host:'#demo-p6 .kb-visual', pan:'img', hide:['.kb-overlay'], tabs:'#demo-p6 .feature-tabs', key:()=>'p6:kb:' + pressed('#demo-p6 [data-kq]','data-kq')},
    {route:'p6-flow', host:'#demo-p6-flow .kb-fig', pan:'img', hide:['figcaption'], key:()=>'p6:flow'},
    {route:'p6-fly', host:'#flywheel .fly-visual', pan:'img', light:1, key:()=>'p6:fly'}
  ];
  const stages = [];
  function Stage(cfg) {
    const host = document.querySelector(cfg.host);
    if (!host) return null;
    const st = {cfg, host, key:'', timers:[], last:0, tok:0, loops:0};
    host.classList.add('kx-host');
    if (cfg.light) host.classList.add('kx-light');
    (cfg.hide || []).forEach(s => host.querySelectorAll(s).forEach(e => e.classList.add('kx-hide')));
    const pan = cfg.pan && host.querySelector(cfg.pan);
    if (pan) pan.classList.add('kx-pan');
    st.pan = pan;
    const root = document.createElement('div');
    root.className = 'kx';
    root.innerHTML = '<div class="kx-scene"></div><div class="kx-edge"></div><div class="kx-rip l"><i></i><i></i><i></i></div><div class="kx-rip r"><i></i><i></i><i></i></div><div class="kx-steps"></div>' +
      '<div class="kx-hud"><div class="ic"></div><div><small></small><strong></strong><em></em></div></div>' +
      '<div class="kx-say"><span class="who"></span><span class="kx-wave"><i></i><i></i><i></i><i></i><i></i></span><span class="tx"></span></div>' +
      '<div class="kx-out"><span class="ok">' + svg('check') + '</span><div><small></small><b></b></div></div><div class="kx-ind" aria-hidden="true"></div><div class="kx-prog"><i></i></div>';
    host.appendChild(root);
    const $ = s => root.querySelector(s);
    const E = {scene:$('.kx-scene'), edge:$('.kx-edge'), rips:root.querySelectorAll('.kx-rip'), steps:$('.kx-steps'), hud:$('.kx-hud'), say:$('.kx-say'), out:$('.kx-out'), ind:$('.kx-ind'), prog:$('.kx-prog i')};
    const sq = s => (E.scene.querySelector(s));
    const api = {
      host,
      pt:(u, v) => imgPt(host, st.pan || host.querySelector('img'), u, v),
      origin:(u, v) => { if (st.pan) { st.pan.style.setProperty('--kx-ox', u * 100 + '%'); st.pan.style.setProperty('--kx-oy', v * 100 + '%'); } },
      step:n => { E.steps.querySelectorAll(':scope>span').forEach((s, i) => { s.classList.toggle('on', i === n - 1); s.classList.toggle('done', i < n - 1 || n > 3); }); },
      ph:n => { const r = E.scene.firstElementChild; if (r) r.dataset.ph = n; },
      hud:(ic, t, s, tone) => { E.hud.dataset.tone = tone || ''; E.hud.querySelector('.ic').innerHTML = svg(ic); E.hud.querySelector('small').innerHTML = T('镜片 HUD','Lens HUD'); E.hud.querySelector('strong').innerHTML = TT(t); E.hud.querySelector('em').innerHTML = s ? TT(s) : ''; E.hud.classList.remove('go'); void E.hud.offsetWidth; E.hud.classList.add('go'); },
      hudOff:() => E.hud.classList.remove('go'),
      fx:cue => window.KnightVoice.effect(cue, st),
      voice:text => { st.line = window.KnightVoice.scene(text, st); },
      say:(who, t) => { api.voice(Array.isArray(t) ? t[0] : t); E.out.classList.remove('go'); E.say.dataset.who = who; E.say.querySelector('.who').innerHTML = who === 'rider' ? T('骑手','RIDER') : T('骑士','KNIGHT'); E.say.querySelector('.tx').innerHTML = TT(t); E.say.classList.remove('go'); void E.say.offsetWidth; E.say.classList.add('go'); },
      sayOff:() => E.say.classList.remove('go'),
      flash:tone => { E.edge.dataset.tone = tone; E.edge.classList.remove('go'); void E.edge.offsetWidth; E.edge.classList.add('go'); },
      buzz:() => E.rips.forEach(r => { r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); }),
      out:t => { E.say.classList.remove('go'); api.step(4); E.out.querySelector('small').innerHTML = T('解决了什么','WHAT IT SOLVES'); E.out.querySelector('b').innerHTML = TT(t); E.out.classList.add('go'); },
      click:s => { const b = document.querySelector(s); if (b && !b.disabled) { const ae = document.activeElement; window.KnightVoice.proxyClick(b); if (document.activeElement === b) { b.blur(); if (ae && ae !== b && ae.focus) try { ae.focus({preventScroll:true}); } catch (e) {} } } },
      textOf:s => (document.querySelector(s) || {}).textContent || '',
      later:(ms, fn) => { const tok = st.tok; st.timers.push(setTimeout(() => { if (st.tok === tok && st.alive) fn(); }, ms)); },
      anim:(dur, fn) => { const tok = st.tok, t0 = performance.now(); const f = now => { if (st.tok !== tok || !st.alive) return; const r = Math.min(1, (now - t0) / dur); try { fn(r, now - t0); } catch (err) { console.error('kx', st.key, err); return; } if (r < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); },
      count:(s, a, b, dur, dec = 0, suf = '') => { const el = sq(s); if (!el) return; api.anim(dur, r => { const e = 1 - Math.pow(1 - r, 3); el.textContent = num(a + (b - a) * e, dec) + suf; }); },
      q:s => sq(s), qa:s => [...E.scene.querySelectorAll(s)],
      css:(s, p, v) => { const el = sq(s); if (el) { if (p.startsWith('--')) el.style.setProperty(p, v); else el.style[p] = v; } },
      text:(s, v) => { const el = sq(s); if (el) el.textContent = v; },
      html:(s, v) => { const el = sq(s); if (el) el.innerHTML = v; },
      add:(s, c) => { const el = sq(s); if (el) el.classList.add(c); },
      rm:(s, c) => { const el = sq(s); if (el) el.classList.remove(c); },
      addAll:(s, c) => E.scene.querySelectorAll(s).forEach(e => e.classList.add(c)),
      stagger:(s, gap, cue) => E.scene.querySelectorAll(s).forEach((e, i) => api.later(i * gap, () => {
        e.classList.add('on');
        if (cue) api.fx(cue);
      })),
      zoom:z => { host.style.setProperty('--kx-z', z); host.classList.add('kx-zoom'); },
      shake:() => { host.classList.remove('kx-shake'); void host.offsetWidth; host.classList.add('kx-shake'); },
      dot:(to, dur) => { const path = sq('.kx-prof .ln'), dot = sq('[data-dot]'); if (!path || !dot) return; const L = path.getTotalLength(); api.anim(dur, r => { const p = path.getPointAtLength(L * to * (1 - Math.pow(1 - r, 2))); dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); }); },
      playVideo:s => { const v = document.querySelector(s); if (v) { if (v === teamFilm) prepareTeamFilm(); v.muted = true; try { v.currentTime = 0; } catch (e) {} const p = v.play(); if (p && p.catch) p.catch(() => {}); } }
    };
    st.api = api;
    st.renderSteps = () => { E.steps.innerHTML = STEPS.map((s, i) => '<span><b>' + (i + 1) + '</b>' + T(s[0], s[1]) + '</span>').join(''); };
    st.renderInd = () => {
      const list = D[st.key] || [];
      E.ind.innerHTML = list.length > 1 ? list.map((d, i) => '<span data-i="' + i + '"' + (i === st.last ? ' class="on"' : '') + '><b>' + (i + 1) + '</b>' + T(d.l[0], d.l[1]) + '</span>').join('') : '';
    };
    st.reset = () => {
      st.alive = false; st.tok++;
      window.KnightVoice.stopScene(st);
      st.line = null;
      E.prog.style.transition = 'none'; E.prog.style.width = '0%'; st.timers.forEach(clearTimeout); st.timers = [];
      host.classList.remove('kx-on','kx-play','kx-done','kx-zoom','kx-shake');
      host.style.removeProperty('--kx-z');
      E.scene.innerHTML = ''; ['hud','say','out'].forEach(n => E[n].classList.remove('go'));
      E.edge.classList.remove('go'); E.rips.forEach(r => r.classList.remove('go'));
      api.step(0);
    };
    st.play = i => {
      const list = D[st.key]; if (!list || !list[i]) return;
      st.reset(); st.alive = true; st.last = i;
      host.dataset.kxk = st.key; host.dataset.kxi = i;
      E.ind.querySelectorAll('span').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
      const d = list[i];
      if (window.KnightVoice.audible && st.key === 'p2:awards') {
        window.KnightFoley.warm(['tally','medal1','medal2','medal3','medal4']);
      }
      try { if (cfg.pre) cfg.pre(api); if (d.pre) d.pre(api); } catch (err) { console.error('kx pre', st.key, err); }
      E.scene.innerHTML = typeof d.scene === 'function' ? d.scene(api) : d.scene ? SC[d.scene](api) : '';
      const end = d.run[d.run.length - 1][0] + 900;
      const token = st.tok;
      void E.prog.offsetWidth;
      host.classList.add('kx-on','kx-play');
      function advance(i) {
        if (token !== st.tok || !st.alive) return;
        if (i === d.run.length) {
          host.classList.remove('kx-play'); host.classList.add('kx-done');
          host.dataset.kxLoops = ++st.loops;
          api.later(LOOP_GAP, () => { if (!document.hidden && current() === cfg.route) st.play((st.last + 1) % list.length); });
          return;
        }
        const [time, action] = d.run[i];
        const nextTime = d.run[i + 1]?.[0] ?? end;
        st.line = null;
        try { action(api); } catch (error) { console.error('kx', st.key, error); }
        const cue = st.line;
        const gap = nextTime - time;
        E.prog.style.transition = 'width ' + Math.max(gap, cue?.ms || 0) + 'ms linear';
        E.prog.style.width = (nextTime / end * 100) + '%';
        api.later(gap, () => {
          if (cue) cue.done.then(() => advance(i + 1));
          else advance(i + 1);
        });
      }
      api.later(d.run[0][0], () => advance(0));
    };
    st.sync = () => { const k = cfg.key(); if (k !== st.key) { st.key = k; st.last = 0; } st.renderInd(); };
    st.start = () => { st.reset(); st.sync(); st.loops = 0; host.dataset.kxLoops = 0; if (!D[st.key]) return; const tok = st.tok; st.timers.push(setTimeout(() => { if (st.tok === tok) st.play(0); }, 450)); };
    st.refresh = () => { root.querySelectorAll('[data-zh]').forEach(e => { e.textContent = isEn() ? e.dataset.en : e.dataset.zh; }); st.renderInd(); E.ind.querySelectorAll('span').forEach(b => b.classList.toggle('on', +b.dataset.i === st.last)); };
    if (cfg.tabs) document.querySelector(cfg.tabs)?.addEventListener('click', e => {
      if (!e.target.closest('button')) return;
      st.reset();
      window.KnightVoice.stopManual();
      const tabToken = st.tok;
      setTimeout(() => { if (tabToken === st.tok && current() === cfg.route) st.start(); }, 60);
    });
    st.renderSteps();
    return st;
  }
  function current() {
    const pg = document.querySelector('[data-page]:not([hidden])'); if (!pg) return '';
    const id = pg.dataset.page, pane = pg.querySelector('[data-pane]:not([hidden])');
    return pane && pane.dataset.pane !== 'demo' ? id + '-' + pane.dataset.pane : id;
  }
  function onRoute(detail) {
    for (const st of stages) if (st.cfg.route !== detail) st.reset();
    const st = stages.find(s => s.cfg.route === detail);
    document.getElementById('knight-replay').hidden = !st;
    if (st) st.start();
  }
  function init() {
    for (const c of CFG) { const st = Stage(c); if (st) stages.push(st); }
    window.addEventListener('ride:route', e => onRoute(e.detail));
    window.addEventListener('knight:manual', () => {
      const st = stages.find(s => s.cfg.route === current());
      if (st) st.reset();
    });
    window.addEventListener('knight:replay', () => {
      const st = stages.find(s => s.cfg.route === current());
      if (!st || document.hidden) return;
      window.KnightVoice.stopManual();
      st.sync();
      st.play(st.last);
    });
    window.addEventListener('ride:lang', () => { stages.forEach(s => s.refresh()); hotsRefresh(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stages.forEach(s => s.reset()); else onRoute(current()); });
    onRoute(current());
    initHots();
  }

  /* ---------- home: product hotspots ---------- */
  const HOTS = [
    {u:.84, v:.35, t:['摄像头','Camera'], d:['第一视角拍照录像，识别前车与沿途地标','POV photos & video; spots the car ahead and landmarks']},
    {u:.60, v:.29, t:['麦克风','Microphones'], d:['定向拾音 · 风噪过滤，听清「你好骑士」','Directional pickup with wind-noise filtering']},
    {u:.43, v:.42, t:['HUD 显示','HUD display'], d:['导航与预警直接显示在镜片上','Navigation and alerts right in the lens']},
    {u:.72, v:.60, t:['包覆式镜片','Wrap-around lens'], d:['贴合头盔佩戴，视野开阔','Fits inside your helmet with a wide view']},
    {u:.19, v:.44, t:['骨传导扬声器','Bone-conduction speaker'], d:['语音播报不堵耳朵，听得见路况','Voice prompts with ears open to the road']}
  ];
  const handset = window.matchMedia('(max-width:760px)');
  const handsetPoints = [[.286,.39],[.59,.30],[.39,.53],[.69,.62],[.835,.365]];
  let selectedComponent = 0;
  let hotsBox, hotIdx = 0, hotTimer = 0, hotPause = false;
  function initHots() {
    const hero = document.querySelector('.hero'), vis = hero && hero.querySelector('.hero-visual');
    if (!vis) return;
    const flt = vis.querySelector('.kx-float');
    hotsBox = document.createElement('div'); hotsBox.className = 'kx-hots';
    hotsBox.innerHTML = HOTS.map((h, i) => '<button type="button" class="kx-hot" hidden data-hot="' + i + '"><span class="lb"><b>' + T(h.t[0], h.t[1]) + '</b><small>' + T(h.d[0], h.d[1]) + '</small></span></button>').join('');
    flt.appendChild(hotsBox);
    hero.querySelector('[data-next-component]').addEventListener('click', () => {
      setHot((selectedComponent + 1) % HOTS.length);
      window.KnightVoice.effect('hotspot');
    });
    hotsBox.addEventListener('focusin', e => {
      const button = e.target.closest('.kx-hot');
      if (button) setHot(Number(button.dataset.hot));
    });
    setHot(0);
    const hint = document.createElement('div'); hint.className = 'kx-hint'; hint.innerHTML = '● ' + T('点击热点，看看眼镜里有什么','Tap the hotspots to explore the glasses');
    hero.appendChild(hint);
    hotsBox.addEventListener('mouseover', e => { const b = e.target.closest('.kx-hot'); if (b) { hotPause = true; setHot(+b.dataset.hot); } });
    hotsBox.addEventListener('mouseleave', () => { hotPause = false; });
    hotsBox.addEventListener('click', e => { const b = e.target.closest('.kx-hot'); if (b) { hotPause = true; setHot(+b.dataset.hot); clearTimeout(hotsBox._r); hotsBox._r = setTimeout(() => { hotPause = false; }, 6000); } });
    hero.addEventListener('pointermove', e => { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; const r = hero.getBoundingClientRect(); vis.style.setProperty('--ry', ((e.clientX - r.left) / r.width - .5) * 8 + 'deg'); vis.style.setProperty('--rx', -((e.clientY - r.top) / r.height - .5) * 6 + 'deg'); });
    hero.addEventListener('pointerleave', () => { vis.style.setProperty('--ry','0deg'); vis.style.setProperty('--rx','0deg'); });
    const img = flt.querySelector('img[data-look-image="product"]');
    const place = () => placeHots(img, flt);
    if (img.complete && img.naturalWidth) place(); else img.addEventListener('load', place, {once:true});
    window.addEventListener('resize', place);
    window.addEventListener('ride:route', e => { if (e.detail === 'home') setTimeout(place, 80); });
    setTimeout(place, 300);
    hotTimer = setInterval(() => { if (handset.matches || hotPause || document.hidden) return; const vis2 = [...hotsBox.querySelectorAll('.kx-hot')].filter(b => !b.hidden); if (!vis2.length) return; hotIdx = (hotIdx + 1) % vis2.length; setHot(+vis2[hotIdx].dataset.hot); }, 2600);
  }
  function setHot(i) {
    selectedComponent = i;
    const lang = isEn() ? 1 : 0;
    hotsBox.querySelectorAll('.kx-hot').forEach(b => {
      const n = Number(b.dataset.hot), active = n === i;
      b.classList.toggle('on',active);
      b.setAttribute('aria-pressed',String(active));
      b.setAttribute('aria-label',HOTS[n].t[lang]);
    });
    document.getElementById('component-name').textContent = HOTS[i].t[lang];
    document.getElementById('component-note').textContent = HOTS[i].d[lang];
    document.querySelector('.detail-count').textContent = String(i+1).padStart(2,'0') + ' / ' + String(HOTS.length).padStart(2,'0');
  }
  function placeHots(img, box) {
    if (!img || !img.naturalWidth || !box.offsetWidth) return;
    const blockers = handset.matches ? [] : [...document.querySelectorAll('.hero-body > *, .hardware-switch, .kx-hint')].map(e => e.getBoundingClientRect()).filter(r => r.width);
    const br = box.getBoundingClientRect();
    HOTS.forEach((h, i) => {
      const [u,v] = handset.matches ? handsetPoints[i] : [h.u,h.v];
      const p = imgPt(box, img, u, v), b = hotsBox.children[i];
      b.style.left = p.x + 'px'; b.style.top = p.y + 'px';
      const ax = br.left + p.x, ay = br.top + p.y;
      const hit = blockers.some(r => ax > r.left - 40 && ax < r.right + 40 && ay > r.top - 30 && ay < r.bottom + 30) || p.x < 10 || p.y < 10 || p.x > br.width - 10 || p.y > br.height - 10;
      b.hidden = hit; b.classList.toggle('dn', p.y < 110);
      b.classList.toggle('rt', p.x > br.width - 130); b.classList.toggle('lt', p.x < 130);
    });
    const first = [...hotsBox.children].find(b => !b.hidden); if (first && !hotsBox.querySelector('.kx-hot.on:not([hidden])')) setHot(+first.dataset.hot);
  }
  function hotsRefresh() { if (hotsBox) setHot(selectedComponent); if (hotsBox) hotsBox.querySelectorAll('[data-zh]').forEach(e => { e.textContent = isEn() ? e.dataset.en : e.dataset.zh; }); document.querySelectorAll('.kx-hint [data-zh]').forEach(e => { e.textContent = isEn() ? e.dataset.en : e.dataset.zh; }); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();


/* One scene control for the handset, backed by the existing demo buttons. */
(() => {
  const mobile = matchMedia('(max-width: 760px)');
  const glyphs = {
    brake:'<path d="M4 14.5 6 10h11l2.5 4.5v4H4zM5.5 18.5v1m12-1v1M7 15h1.5m6.5 0h1.5M6 6.5l1.8-2m3.7 2v-3m4 3 1.8-2"/>',
    tire:'<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><path d="m5.5 6.5 2.2 1m9.8 10-2.2-1m-9.5.2 2-1.4M18 6.4l-2 1.2"/>',
    pulse:'<path d="M2.5 12h5l2.2-5.5 3.4 11 2.4-7 1.7 1.5h4.3"/>',
    alert:'<path d="m10.6 4.5-8 13.9A1.6 1.6 0 0 0 4 20.8h16a1.6 1.6 0 0 0 1.4-2.4l-8-13.9a1.6 1.6 0 0 0-2.8 0Z"/><path d="M12 9v4.6m0 3.1v.2"/>',
    nav:'<path d="m20.6 3.5-6.9 17.2-2.3-8.1-8.2-2.2z"/>',
    mic:'<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.5 11.7a6.5 6.5 0 0 0 13 0M12 18.2v3M9 21.2h6"/>',
    film:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 8.7 5.5 3.3-5.5 3.3z"/>',
    pin:'<path d="M19 10c0 4.8-7 11-7 11S5 14.8 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.4"/>',
    crew:'<circle cx="9" cy="8" r="3.1"/><path d="M2.8 19a6.2 6.2 0 0 1 12.4 0M15.1 5.5a2.8 2.8 0 0 1 0 5.1m2.2 2.4c2.3.6 3.7 2.6 3.7 5.2"/>',
    rank:'<path d="M4 19h16M6 15v-3m6 3V6m6 9V9"/>',
    flag:'<path d="M5 21V4m0 1c4-3 9 2.5 14-.6v10c-5 3-10-2.5-14 .6"/>',
    medal:'<circle cx="12" cy="14.5" r="5.4"/><path d="M5.5 3h4l3.1 6.1M18.5 3h-4L12 7m0 5.4v4.2m-2.1-2.1h4.2"/>',
    radio:'<path d="M5 9a9 9 0 0 1 14 0M7.6 12a5.7 5.7 0 0 1 8.8 0M10.3 15a2.4 2.4 0 0 1 3.4 0"/><circle cx="12" cy="18" r=".9"/>',
    fuel:'<path d="M3.5 20h10V5h-9v15m1-10h7m2 0h1.1c1.2 0 2 .8 2 2v4.8a1.9 1.9 0 0 0 3.8 0V9l-3.2-3.2"/>',
    snap:'<path d="M3.2 8h4l1.5-2.6h6.6L16.8 8h4v11H3.2z"/><circle cx="12" cy="13.1" r="3.1"/>',
    album:'<rect x="4" y="4" width="16" height="16" rx="2.3"/><circle cx="9" cy="9" r="1.5"/><path d="m5 17 4.5-4.8 3.2 3.2 2.2-2.4 4.5 4.5"/>',
    bolt:'<path d="M13.7 2.8 5.1 13.1h5.8l-.6 8.1 8.6-11.3h-5.7z"/>',
    link:'<path d="m9 8 2-2a4.2 4.2 0 0 1 6 6l-2 2M9 10l-2 2a4.2 4.2 0 0 0 6 6l2-2m-6-2 6-6"/>',
    summit:'<path d="m2.5 19 9.4-15.4L21.5 19zM8.5 9.3l2.9 1.8 1.8-1.6 2.6 1.2"/>',
    rain:'<path d="M6 14a4 4 0 0 1-.5-8 5.1 5.1 0 0 1 9.8-.1 4 4 0 0 1 1.3 8.1M8 16.8l-1.2 2.4m5-2.4-1.2 2.4m5-2.4-1.2 2.4"/>',
    check:'<path d="m5 12 4.4 4.4L19 7"/>',
    down:'<path d="m6.5 9.2 5.5 5.5 5.5-5.5"/>'
  };
  const icon = key => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+glyphs[key]+'</svg>';
  // The order mirrors the controls in each desktop demo. The originals still own every action.
  const list = {
    p1:[['brake','追尾预警','Collision alert'],['tire','胎压胎温','Tire monitor'],['pulse','疲劳监测','Fatigue'],['alert','摔车求助','Crash SOS'],['summit','高原提醒','Altitude alerts'],['rain','天气路况','Weather & road']],
    p5:[['nav','导航与音乐','Nav & music'],['mic','消息与对话','Messages & AI'],['film','骑行剪辑','Ride edit'],['pin','打卡与成就','Check-ins']],
    p2:[['crew','附近组队','Find riders'],['rank','位置与排名','Live positions'],['flag','车队竞赛','Crew race'],['mic','同路致意','Rider greetings'],['medal','骑行高光榜','Ride highlights']],
    p3:[['radio','掉队预警','Gap alert'],['crew','险情互助','Crew rescue'],['pin','标记路况','Road hazards'],['mic','队内通话','Crew calls'],['link','离线直连','Offline link'],['fuel','加油集结','Fuel stop']],
    p4:[['film','车队成片','Crew film'],['pin','打卡同步','Sync check-ins'],['snap','语音抓拍','Voice capture'],['album','地图相册','Map album']],
    p6:[['bolt','打不着火','Engine start'],['tire','半路扎胎','Flat tire'],['link','链条异响','Noisy chain'],['summit','高原动力','At altitude'],['rain','雨天过弯','Wet corners']]
  };
  const intros = {"p1":[["前车急刹时，镜片标出车距，语音提醒你减速。","When the car ahead brakes, the lens shows the gap and a voice asks you to slow down."],["后轮胎压下降、胎温升高，眼镜提醒你停车检查。","As rear tire pressure drops and temperature rises, the glasses suggest stopping for a check."],["连续骑行三小时后，眼镜提醒你休息，并标出前方休息区。","After three hours in the saddle, the glasses suggest a break and mark the next rest stop."],["检测到摔车后，眼镜先询问你的状况，倒计时结束仍无回应就发送求助位置。","After a fall, the glasses check on you and share your location if the countdown ends without a reply."],["海拔升高时，眼镜结合健康记录和沿途天气，提醒骑手留意身体变化。","The glasses combine altitude, weather and health readings to flag changes during a climb."],["前方路段有阵雨时，眼镜提醒你留意湿滑弯道。","When rain is expected on the route, the glasses flag slippery bends ahead."]],"p5":[["临近弯道，音乐自动变轻，等眼镜报完方向再恢复音量。","The music dips before a bend and returns once the glasses finish giving directions."],["眼镜读出来信，说一句就能回复，也能接电话或向骑士提问。","The glasses read incoming messages aloud so you can reply, take a call or ask Knight a question by voice."],["眼镜标出沿途的精彩片段，收车后就能看到当天的短片和手帐。","The glasses tag moments along the way and turn them into a short film and ride journal."],["骑到折多山垭口，照片和坐标自动记入行程，并解锁打卡徽章。","At Zheduo Pass, a photo and location are saved to your ride, unlocking a check-in badge."]],"p2":[["手机扫出附近摩友，队友陆续入队，眼镜报出到齐人数。","The phone finds nearby riders, and the glasses announce when everyone has joined."],["地图上的车手随队伍前进，名次变化或有人掉队时，眼镜会播报。","Riders move along the map while the glasses announce position changes and gaps in the group."],["倒计时结束，车队开始分段计时，冲线后就能看到本段排名。","The countdown starts the timed ride, with split updates on the way and results at the finish."],["前方出现同向车队时，你可以开口打招呼，对方回话会显示为字幕。","Greet a crew riding up ahead and their spoken reply appears as captions."],["收车后，里程和抓拍数汇总，每位获奖队友的徽章依次亮起。","At the end of the ride, distance and photos are tallied before the crew’s award badges light up."]],"p3":[["三号车落后时，领队收到提醒，设好集合点后全队同步导航。","When rider 03 falls behind, the leader gets an alert and shares a meeting point with the crew."],["三号车求助时，全队看到位置，附近的四号车收到返回路线。","When rider 03 calls for help, everyone sees the location and nearby rider 04 gets a route back."],["前车说出路面危险，眼镜在地图上留标记，后车靠近时收到提醒。","The lead rider calls out a hazard and a map pin warns the riders behind as they approach."],["车速升高时，队内消息改为语音播报，减速后再接通领队。","At higher speeds, crew messages are read aloud and the call to the leader resumes once you slow down."],["山里没有手机信号时，眼镜之间接力传递位置和预警。","When cell service drops in the mountains, the glasses relay locations and alerts from rider to rider."],["二号车油量偏低，领队选定前方加油站，眼镜通知全队集合。","When rider 02 runs low on fuel, the leader picks a station and the glasses tell everyone where to regroup."]],"p4":[["四位骑手各自拍下的画面，按时间和位置对齐，剪成一支车队短片。","Footage from four riders is matched by time and location, then cut into one crew film."],["沿途的打卡点、海拔和照片汇成路书，同步到全队眼镜。","Check-ins, elevations and photos form a ride log that syncs to the crew’s glasses."],["说「拍一张」，眼镜就把眼前的风景连同位置和海拔存入车队相册。","Say “take a photo” to save the view, location and altitude to the crew album."],["全队照片按拍摄地点排在地图上，沿路线就能找到当时的画面。","Crew photos are grouped by location so you can follow the route to find a moment."]],"p6":[["摩托车打不着火时，骑士找到相似案例，念出车友检查开关和电瓶的顺序。","When the bike won’t start, Knight finds similar cases and reads out how riders checked the switches and battery."],["怀疑扎胎时，骑士从车友经历里找到应对步骤，先提醒你安全靠边。","If you suspect a puncture, Knight draws on other riders’ experiences and first suggests pulling over safely."],["听到链条异响，骑士会找出类似案例，说清车友检查了哪些地方。","Describe a rattling chain and Knight finds similar cases and explains what those riders checked."],["在高原觉得车没劲，骑士会找来相似路况下车友的爬坡经验。","When the bike loses power at altitude, Knight finds climbing tips from riders in similar conditions."],["问起雨天过弯，骑士会从社区案例里找出湿滑路面上的骑行经验。","Ask about wet corners and Knight reads out tips from riders who faced similar roads."]],"flow":["车友帖子按车型和路况归档，下次有人提问，骑士就能找到相关经验。","Rider posts are grouped by bike and road conditions so Knight can find a relevant case for the next question."],"fly":["如果你常在下午犯困，骑士会参考以往骑行记录，提前提醒你休息。","If you often get tired in the afternoon, Knight uses past rides to suggest a break earlier."]};
  window.knightScenarioIndex = {list, intros};
  const crewGroups = [['p2','组队娱乐','Group ride'],['p3','安全互助','Safety'],['p4','一起记录','Memories']];
  const communityGroups = [['demo','知识问答','Rider Q&A'],['flow','社区经验','Community tips'],['fly','个性化提醒','Personal alerts']];
  const panels = new Map();
  let openPicker = null, pending = null;
  const soundOwner=Symbol('scene-picker');
  const en = () => document.documentElement.lang === 'en';
  const label = row => row[en()?2:1];
  const inCrew = id => ['p2','p3','p4'].includes(id);
  function button(cls) {
    const b=document.createElement('button'); b.type='button'; b.className=cls; return b;
  }
  function current(picker) {
    const sub=picker.page.querySelector('[data-subview][aria-pressed="true"]')?.dataset.subview || 'demo';
    const idx=picker.native.findIndex(b=>b.getAttribute('aria-pressed')==='true');
    return {sub,index: Math.max(0,idx)};
  }
  function updateTrigger(picker) {
    const {sub,index}=current(picker);
    let item=list[picker.id][index];
    if(picker.id==='p6' && sub!=='demo') {
      const g=communityGroups.find(r=>r[0]===sub);
      if(g) item=[sub==='flow'?'crew':'pulse',g[1],g[2]];
    }
    const context=picker.id==='p6' && sub!=='demo' ? intros[sub] : intros[picker.id][index];
    const caption=context[en()?1:0];
    if(picker.intro.textContent!==caption) picker.intro.textContent=caption;
    const text=label(item);
    picker.trigger.innerHTML='<span class="scene-icon">'+icon(item[0])+'</span><span class="scene-name"></span>'+icon('down');
    picker.trigger.querySelector('.scene-name').textContent=text;
    picker.trigger.setAttribute('aria-label',(en()?'Change scene, ':'切换场景，')+text);
  }
  function closeMenu(restoreFocus=false) {
    if(!openPicker) return;
    const p=openPicker; openPicker=null;
    p.panel.hidden=true; p.trigger.setAttribute('aria-expanded','false');
    if(restoreFocus) p.trigger.focus({preventScroll:true});
  }
  function activate(picker,target,index,sub='demo') {
    closeMenu();
    const next=panels.get(target);
    if(!next) return;
    if(picker.id!==target) {
      pending={id:target,index};
      location.hash='/'+target;
      return;
    }
    const selected=current(next);
    if(target==='p6' && selected.sub!==sub) next.page.querySelector('[data-subview="'+sub+'"]')?.click();
    if(sub==='demo' && selected.index!==index) {
      next.native[index]?.click();
      if(selected.sub===sub) window.KnightVoice?.effect('tab',soundOwner);
    }
    updateTrigger(next);
    next.trigger.focus({preventScroll:true});
  }
  function draw(picker, browse, focusGroup=false) {
    picker.panel.replaceChildren();
    const isTeam=inCrew(picker.id);
    const groups=isTeam?crewGroups:null;
    if(groups) {
      const group=document.createElement('div'); group.className='scene-families';
      group.setAttribute('role','group');group.setAttribute('aria-label',en()?'Scene group':'场景分类');
      for(const row of groups) {
        const b=button('scene-family'), id=row[0]; b.textContent=label(row);
        b.setAttribute('aria-pressed',String(id===browse));
        b.addEventListener('click',()=>{
          if(!isTeam && id!=='demo') {activate(picker,'p6',0,id); return;}
          draw(picker,id,true);
        });
        group.append(b);
      }
      picker.panel.append(group);
      if(focusGroup) group.querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});
      if(!isTeam && browse!=='demo') return;
    }
    const target=isTeam?browse:picker.id;
    const options=document.createElement('div'); options.className='scene-options';
    const actual=current(picker);
    list[target].forEach((item,index)=>{
      const b=button('scene-choice');
      const on=target===picker.id && actual.sub==='demo' && actual.index===index;
      b.setAttribute('aria-pressed',String(on));
      b.innerHTML='<span class="choice-icon">'+icon(item[0])+'</span><span class="choice-label"></span>'+(on?icon('check'):'');
      b.querySelector('.choice-label').textContent=label(item);
      b.addEventListener('click',()=>activate(picker,target,index));
      options.append(b);
    });
    picker.panel.append(options);
  }
  for(const id of Object.keys(list)) {
    const page=document.querySelector('[data-page="'+id+'"]');
    const mast=page.querySelector('.module-mast');
    const native=[...page.querySelectorAll('.feature-tabs > button')];
    if(native.length!==list[id].length) continue;
    const trigger=mast.querySelector('.scene-trigger'), panel=mast.querySelector('.scene-library');
    if(!trigger || !panel) continue;
    const picker={id,page,mast,native,trigger,panel,intro:mast.querySelector('.scene-intro')}; panels.set(id,picker);
    trigger.addEventListener('click',()=>{
      if(openPicker===picker){closeMenu();return;}
      closeMenu(); openPicker=picker;
      panel.hidden=false; trigger.setAttribute('aria-expanded','true');
      draw(picker,id==='p6'?current(picker).sub:id);
    });
    const sync=new MutationObserver(()=>updateTrigger(picker));
    for(const b of [...native,...page.querySelectorAll('[data-subview]')]) sync.observe(b,{attributes:true,attributeFilter:['aria-pressed']});
    updateTrigger(picker); page.classList.add('has-scene-picker');
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && openPicker){e.preventDefault();closeMenu(true);}});
  document.addEventListener('pointerdown',e=>{if(openPicker && !openPicker.mast.contains(e.target))closeMenu();},true);
  document.addEventListener('focusin',e=>{if(openPicker && !openPicker.mast.contains(e.target))closeMenu();});
  window.addEventListener('ride:lang',()=>{closeMenu();panels.forEach(updateTrigger);});
  window.addEventListener('ride:route',()=>{closeMenu();});
  window.addEventListener('hashchange',()=>{
    const intent=pending; pending=null;
    if(!intent || !mobile.matches) return;
    const p=panels.get(intent.id);
    if(!p || p.page.hidden) return;
    if(current(p).index!==intent.index) p.native[intent.index]?.click();
    updateTrigger(p);p.trigger.focus({preventScroll:true});
  });
  mobile.addEventListener('change',()=>closeMenu());
})();

(() => {
  const root = document.querySelector('[data-page="home"]');
  function disclose(button, container, open) {
    container.classList.toggle('qh-open', open);
    button.setAttribute('aria-expanded', String(open));
  }
  for (const button of root.querySelectorAll('.qh-chapter,.qh-explore')) {
    const container = button.closest('.hardware-gallery,section.pitch-block');
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') !== 'true';
      disclose(button, container, open);
      if (button.classList.contains('qh-explore')) window.KnightVoice?.effect('hotspot');
    });
    container.addEventListener('keydown', event => {
      if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true' &&
          matchMedia('(max-width:760px)').matches) {
        disclose(button, container, false);
        button.focus();
      }
    });
  }
})();

/* Keep the original live console intact when a handset reader opens its notes. */
(() => {
  const handset = window.matchMedia('(max-width:760px)');
  const panels = document.querySelectorAll(
    '.p1-frame > .p1-console, .stage > .p2-dash, .p3-body > .p3-console, ' +
    '.rec-stage > .rec-console, .kb-stage > .kb-console, .kb-flow > .kb-side, #flywheel > .fly-console'
  );
  function adaptPanels() {
    panels.forEach(panel => {
      const existing = panel.closest('.scene-fold');
      if (handset.matches && !existing) {
        const parent = panel.parentElement;
        const fold = document.createElement('details');
        fold.className = 'scene-fold';
        fold.innerHTML = '<summary><span lang="zh-CN">骑行细节</span><span lang="en">Ride details</span><i aria-hidden="true"></i></summary>';
        parent.insertBefore(fold,panel);
        fold.append(panel);
        parent.classList.add('scene-with-fold');
      } else if (!handset.matches && existing) {
        const active = document.activeElement;
        const restore = panel.contains(active);
        const parent = existing.parentElement;
        parent.insertBefore(panel,existing);
        existing.remove();
        parent.classList.remove('scene-with-fold');
        if (restore) active.focus({preventScroll:true});
      }
    });
  }
  adaptPanels();
  handset.addEventListener('change',adaptPanels);
  window.addEventListener('ride:route',() => {
    document.querySelectorAll('.scene-fold[open]').forEach(fold => { fold.open = false; });
  });
  document.addEventListener('click',event => {
    const choice = event.target.closest('.feature-tabs button');
    if (!choice || choice.getAttribute('aria-pressed') === 'true') return;
    const fold = choice.closest('.module-demo')?.querySelector('.scene-fold[open]');
    if (fold) fold.open = false;
  },true);
})();


(() => {
  const directory = document.getElementById('par-directory');
  const plans = document.getElementById('par-plans');
  const index = window.knightScenarioIndex;
  if (!directory || !plans || !index) return;
  const groups = {
    p1:['个人守护','Personal safety'], p5:['AI 随行','AI companion'],
    p2:['组队娱乐','Group rides'], p3:['安全互助','Crew safety'],
    p4:['一起记录','Crew memories'], p6:['骑士社区','Rider community']
  };
  const extras = {flow:['骑友经验','Rider stories'],fly:['个性化提醒','Personal alerts']};
  const appPages=[
    ['home','设备与骑行概览','Devices & dashboard','设备 连接 眼镜 电量 主页 dashboard devices battery glasses'],
    ['ai','骑行 AI 对话','Riding assistant','语音输入 语音对话 打字 问答 聊天 assistant chat voice keyboard'],
    ['team','附近组队','Find a crew','面对面 雷达 扫描 邀请 队友 group invite radar nearby'],
    ['route','团队路线','Crew route','导航 定位 排名 积分榜 排行榜 路况 地图 打卡 导航标记 map location ranks navigation check-in'],
    ['journal','行迹与剪辑','Ride journal & editing','轨迹 轨迹回放 录像 剪辑 生活库 相册 视频 记录 replay video edit route journal album'],
    ['community','骑友动态','Rider feed','社区 朋友圈 发布 帖子 评论 点赞 好友 share feed post comments friends'],
    ['guide','问大兵老师','Ask Dabin','大斌 大兵老师 问答库 知识库 摩旅 故障 向量检索 Q&A knowledge advice guide'],
    ['safety','骑行监测','Ride monitoring','胎压 胎温 心率 身体 摔倒 跌倒 摔车 健康 安全检测 tire temperature pressure heart rate health fall'],
    ['media','拍摄与播放','Capture & playback','拍照 录制 录像 录视频 照片 音乐 播放视频 相机 拍摄 music camera capture recording playback'],
    ['me','我的账号','Account & settings','社区积分 骑友 账号 账户 管理 设置 权限 消息提醒 登录 修改密码 换绑 问题反馈 password notifications riders points login privacy']
  ];
  const l = (zh,en) => document.documentElement.lang === 'en' ? en : zh;
  const query = directory.querySelector('input');
  const browse = directory.querySelector('.par-browse');
  const page = key => document.querySelector('[data-page="'+key+'"]');
  const tabs = key => [...page(key).querySelectorAll('.feature-tabs > button')];
  const sceneId = button => button.dataset.sensor || button.dataset.p1Tab || button.dataset.p2Tab || button.dataset.p3Mode || button.dataset.recTab || button.dataset.kq;
  const hasPlan = id => !!plans.querySelector('[data-par-group="'+id+'"]');
  let fromIndex = false;
  let activePlan = '';
  let pending = null;

  function showPlans(group,returnToIndex=false) {
    activePlan=group;
    fromIndex=returnToIndex;
    plans.querySelector('h2').textContent=l(...groups[group]);
    plans.querySelectorAll('[data-par-group]').forEach(row => row.hidden=row.dataset.parGroup!==group);
    plans.showModal();
  }
  function openIndex(reset) {
    if (reset) query.value='';
    renderIndex();
    directory.showModal();
    directory.querySelector('[data-par-close]').focus({preventScroll:true});
  }
  function enterScene(group,key) {
    const target=page(group);
    const sub=key in extras?key:'demo';
    const toggle=target.querySelector('[data-subview="'+sub+'"]');
    if(toggle && toggle.getAttribute('aria-pressed')!=='true') toggle.click();
    if(sub==='demo') {
      const item=tabs(group).find(b=>sceneId(b)===key);
      if(item && item.getAttribute('aria-pressed')!=='true') item.click();
    }
    window.scrollTo({top:0,behavior:'instant'});
    target.querySelector('h1')?.focus({preventScroll:true});
  }
  function navigate(group,key) {
    if(directory.open) directory.close();
    if(!page(group).hidden){enterScene(group,key);return;}
    pending={group,key};
    location.hash='/'+group;
  }
  window.addEventListener('hashchange',()=>{
    const target=pending; pending=null;
    if(target && location.hash==='#/'+target.group && !page(target.group).hidden) enterScene(target.group,target.key);
  });

  function addAction(container,title,click) {
    const b=document.createElement('button');
    b.type='button'; b.textContent=title; b.addEventListener('click',click);container.append(b);
  }
  function renderIndex() {
    const term=query.value.trim().toLocaleLowerCase();
    const open=browse.querySelector('details[open]')?.dataset.group;
    browse.replaceChildren();
    for(const [group,names] of Object.entries(groups)){
      const section=document.createElement('details');section.dataset.group=group;
      const summary=document.createElement('summary');summary.textContent=l(...names);section.append(summary);
      const links=document.createElement('div');links.className='par-links';
      const matches=words=>[...names,...words].join(' ').toLocaleLowerCase().includes(term);
      const native=tabs(group);
      index.list[group].forEach((row,i)=>{
        if(!matches([...row.slice(1),native[i].textContent,...index.intros[group][i]]))return;
        addAction(links,l(row[1],row[2]),()=>navigate(group,sceneId(native[i])));
      });
      if(group==='p6'){
        for(const [key,title] of Object.entries(extras)){
          if(matches([...title,...index.intros[key]]))addAction(links,l(...title),()=>navigate(group,key));
        }
      }
      if(hasPlan(group) && matches(['功能规划','Planned features',...Array.from(plans.querySelector('[data-par-group="'+group+'"]').querySelectorAll('dt')).map(dt=>dt.textContent)])){
        addAction(links,l('功能规划','Planned features'),()=>{directory.close();showPlans(group,true);});
      }
      if(!links.childElementCount)continue;
      section.append(links);
      section.open=!!term || open===group;
      browse.append(section);
    }
    const appNames=['骑士 App','Knight app'];
    const appMatches=appPages.filter(row=>[...appNames,...row.slice(1)].join(' ').toLocaleLowerCase().includes(term));
    if(appMatches.length){
      const section=document.createElement('details');
      section.dataset.group='app';
      section.open=!!term || open==='app';
      const summary=document.createElement('summary');summary.textContent=l(...appNames);section.append(summary);
      const links=document.createElement('div');links.className='par-links';
      appMatches.forEach(([tab,zh,en])=>{
        const a=document.createElement('a');
        a.href='#/app';a.dataset.appTab=tab;a.textContent=l(zh,en);
        a.addEventListener('click',event=>{
          if(!event.button && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey)directory.close();
        });
        links.append(a);
      });
      section.append(links);browse.append(section);
    }
    if(!browse.childElementCount){
      const status=document.createElement('p');status.setAttribute('role','status');
      status.textContent=l('没有找到相符的功能。','No matching features.');browse.append(status);
    }
  }
  document.querySelector('.par-index-open').addEventListener('click',()=>openIndex(true));
  document.querySelectorAll('[data-par-scene]').forEach(a=>a.addEventListener('click',e=>{
    if(e.button || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)return;
    e.preventDefault();navigate(a.hash.slice(2),a.dataset.parScene);
  }));
  query.addEventListener('input',renderIndex);
  for(const dlg of [directory,plans]){
    dlg.querySelector('[data-par-close]').addEventListener('click',()=>dlg.close());
    dlg.addEventListener('click',e=>{
      if(e.target!==dlg)return;
      const r=dlg.getBoundingClientRect();
      if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom)dlg.close();
    });
  }
  plans.addEventListener('close',()=>{
    if(fromIndex){fromIndex=false;openIndex(false);}
  });
  window.addEventListener('ride:lang',()=>{
    if(directory.open) renderIndex();
    if(plans.open)plans.querySelector('h2').textContent=l(...groups[activePlan]);
  });
})();

(() => {
  const frame=document.getElementById('comp-frame');
  const back=document.getElementById('comp-return');
  const sound=document.getElementById('comp-sound');
  const master=document.getElementById('knight-sound');
  const container=frame.closest('[data-page]');
  let source=null, wantTab='home', appliedTab=false, showing=false, returnPosition=0;

  function app(){return frame.contentWindow?.Knight;}
  function updateLabels(){
    const english=document.documentElement.lang==='en';
    const on=master.getAttribute('aria-pressed')==='true';
    const action=on?(english?'Mute sound':'关闭声音'):(english?'Enable sound':'开启声音');
    sound.setAttribute('aria-pressed',String(on));
    sound.setAttribute('aria-label',action); sound.title=action;
    frame.title=english?'Knight companion app (Chinese)':'骑士 App';
    if(!container.hidden) document.title=english?'Knight App | Knight':'骑士 App｜骑士 Knight';
  }
  function syncSound(){
    updateLabels();
    const child=app(); if(!child || !showing) return;
    const enabled=master.getAttribute('aria-pressed')==='true';
    child.state.sound=enabled;
    if(!enabled) frame.contentWindow.speechSynthesis?.cancel();
    for(const el of frame.contentDocument.querySelectorAll('audio,video')) el.muted=!enabled;
    child.render();
  }
  function enterTab(){
    const child=app();
    if(!child || !showing || appliedTab) return;
    appliedTab=true;
    child.resume?.();
    if(wantTab==='journal') child.ride.openJournal();
    else if(child.pages[wantTab]) child.go(wantTab);
    syncSound();
  }
  function loadApp(){
    if(!frame.hasAttribute('src') && !frame.hasAttribute('srcdoc')){
      const inline=document.getElementById('comp-content');
      if(inline){
        const bytes=Uint8Array.from(atob(inline.textContent.trim()),c=>c.charCodeAt(0));
        frame.srcdoc=new TextDecoder().decode(bytes);
      } else frame.src=frame.dataset.src;
    }
    enterTab();
  }
  function stopApp(){
    const child=app(); if(!child) return;
    child.suspend?.();
    for(const el of frame.contentDocument.querySelectorAll('audio,video')) el.pause();
    frame.contentWindow.speechSynthesis?.cancel();
  }

  document.addEventListener('click',e=>{
    const link=e.target.closest('a[data-app-tab]');
    if(!link || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    source=link.closest('#par-directory') ? document.querySelector('.par-index-open') : link;
    returnPosition=window.scrollY;
    back.hash='/'+(link.closest('[data-page]')?.dataset.page||'home');
    wantTab=link.dataset.appTab; appliedTab=false;
  },true);
  function followRoute(){
    if(!container.hidden){
      if(!showing){showing=true;updateLabels();loadApp();}
    } else if(showing){
      showing=false;stopApp();
      if(source && location.hash===back.hash){
        requestAnimationFrame(()=>{
          source.focus({preventScroll:true});
          window.scrollTo({top:returnPosition,behavior:'instant'});
        });
      }
    }
  }
  frame.addEventListener('load',()=>{
    const page=frame.contentDocument;
    page?.addEventListener('play',e=>{
      if(e.target.matches?.('audio,video')) e.target.muted=master.getAttribute('aria-pressed')!=='true';
    },true);
    enterTab();
  });
  window.addEventListener('ride:route',e=>{
    if(e.detail==='background'){stopApp();return;}
    followRoute();
  });
  window.addEventListener('ride:lang',updateLabels);
  window.addEventListener('pagehide',stopApp);
  sound.addEventListener('click',()=>master.click());
  new MutationObserver(syncSound).observe(master,{attributes:true,attributeFilter:['aria-pressed']});
  updateLabels();followRoute();
})();
