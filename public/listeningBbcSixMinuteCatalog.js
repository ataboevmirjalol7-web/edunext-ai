/**
 * BBC Learning English — 6 Minute English (podcast RSS orqali tanlangan chiqishlar).
 * Har bir kun: ((studyDay - 1) % 7) bilan navbatlangan — 1-kun = kofe («Britain's love affair with coffee»).
 * Manba (rss): https://podcasts.files.bbci.co.uk/p02pc9tn.rss — BBC Distribution Policy asosida tinglash uchun.
 */

const EPISODES_7 = [
  {
    titleEn: "Britain's love affair with coffee",
    audioHttps:
      "https://open.live.bbc.co.uk/mediaselector/6/redir/version/2.0/mediaset/audio-nondrm-download-rss-low/proto/https/vpid/p0bzx7bh.mp3",
    programmeUrl: "https://www.bbc.co.uk/programmes/p0bzx7vt",
  },
  {
    titleEn: "Do emojis make language better?",
    audioHttps:
      "https://open.live.bbc.co.uk/mediaselector/6/redir/version/2.0/mediaset/audio-nondrm-download-rss-low/proto/https/vpid/p0cxqp37.mp3",
    programmeUrl: "https://www.bbc.co.uk/programmes/p0cxqq87",
  },
  {
    titleEn: "Can climate change affect our mental health?",
    audioHttps:
      "https://open.live.bbc.co.uk/mediaselector/6/redir/version/2.0/mediaset/audio-nondrm-download-rss-low/proto/https/vpid/p0lhsr51.mp3",
    programmeUrl: "https://www.bbc.co.uk/programmes/p0lhsr6q",
  },
  {
    titleEn: "Scared to speak English?",
    audioHttps:
      "https://open.live.bbc.co.uk/mediaselector/6/redir/version/2.0/mediaset/audio-nondrm-download-rss-low/proto/https/vpid/p0mwg48x.mp3",
    programmeUrl: "https://www.bbc.co.uk/programmes/p0mwg961",
  },
  {
    titleEn: "The technology of translation",
    audioHttps:
      "https://open.live.bbc.co.uk/mediaselector/6/redir/version/2.0/mediaset/audio-nondrm-download-rss-low/proto/https/vpid/p0ccyck5.mp3",
    programmeUrl: "https://www.bbc.co.uk/programmes/p0ccyfd8",
  },
  {
    titleEn: "What English phrases really mean",
    audioHttps:
      "https://open.live.bbc.co.uk/mediaselector/6/redir/version/2.0/mediaset/audio-nondrm-download-rss-low/proto/https/vpid/p0mv3rzk.mp3",
    programmeUrl: "https://www.bbc.co.uk/programmes/p0mv3x5r",
  },
  {
    titleEn: "What makes a good story?",
    audioHttps:
      "https://open.live.bbc.co.uk/mediaselector/6/redir/version/2.0/mediaset/audio-nondrm-download-rss-low/proto/https/vpid/p094pcs0.mp3",
    programmeUrl: "https://www.bbc.co.uk/programmes/p094pd3s",
  },
];

/**
 * @param {number} studyDay
 * @returns {{ cycleIndex: number, titleEn: string, audioHttps: string, programmeUrl: string }}
 */
export function resolveBbcSixMinuteForStudyDay(studyDay) {
  const d = Math.min(30, Math.max(1, Math.floor(Number(studyDay)) || 1));
  const ix = (d - 1) % EPISODES_7.length;
  return { cycleIndex: ix + 1, ...EPISODES_7[ix] };
}
