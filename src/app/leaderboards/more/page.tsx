export const metadata = { title: 'More model leaderboards | Local LLM Radar' };

const boards = [
  { name: 'Object detection', source: 'COCO · Roboflow SAB', url: '/leaderboards/object-detection', description: 'Locate and identify objects in images. Compare COCO val2017 scores, latency and parameters in Radar. Historical test-dev submissions are a separate tab.' },
  { name: 'Image segmentation', source: 'COCO masks / panoptic', url: '/leaderboards/image-segmentation', description: 'Label object and background regions pixel by pixel. Panoptic results are separate from bounding-box detection.' },
  { name: 'Depth estimation', source: 'KITTI', url: '/leaderboards/depth-estimation', description: 'Estimate distance from a single image. The driving-scene benchmark ranks lower SILog error first; it does not establish architectural measurement accuracy.' },
  // Artificial Analysis terms forbid copying, republishing or scraping its data
  // (docs/DATA-SOURCES.md), so its media arenas are links, not imported tables.
  { name: 'Image generation & editing', source: 'Artificial Analysis', url: 'https://artificialanalysis.ai/image/leaderboard/text-to-image', description: 'Preference arenas for text-to-image and image editing models.' },
  { name: 'Video generation', source: 'Artificial Analysis', url: 'https://artificialanalysis.ai/video/leaderboard/text-to-video', description: 'Text-to-video and image-to-video preference arenas. Local hardware fit is under Video → Local hardware fit.' },
  { name: 'Speech to text & text to speech', source: 'Artificial Analysis', url: 'https://artificialanalysis.ai/speech-to-text/non-streaming', description: 'Word error rate for transcription and preference arenas for speech generation.' },
  { name: 'Music generation', source: 'Artificial Analysis', url: 'https://artificialanalysis.ai/music/leaderboard/vocals', description: 'Preference arenas for music with vocals and instrumental music.' },
  { name: 'Voice assistant evaluation', source: 'VoiceBench', url: 'https://matthewcym.github.io/VoiceBench/', description: 'Evaluate spoken interactions and instructions. Local runtime and hardware information is under Audio & speech → Voice assistants / local fit.' },
  { name: 'Forecasting', source: 'GIFT-Eval', url: 'https://huggingface.co/spaces/Salesforce/GIFT-Eval', description: 'Predicting future values from time-series data.' },
  { name: 'Robotics & action', source: 'AllenAI VLA', url: 'https://allenai.github.io/vla-evaluation-harness/leaderboard/', description: 'Vision-language-action models in robot simulation benchmarks.' },
];

export default function MoreLeaderboardsPage() {
  return <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
    <header><h1 className="text-2xl font-bold">More model leaderboards</h1><p className="text-sm text-zinc-500 mt-1">Explore other major model types. Detection, segmentation and depth have full score tables in Radar. The remaining external evaluations are labeled below.</p></header>
    <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">{boards.map(board => <a key={board.url} href={board.url} target={board.url.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer" className="block px-4 py-3 hover:bg-zinc-900">
      <span className="text-sm font-medium text-zinc-200">{board.name} {board.url.startsWith('/') ? '→' : '↗'}</span><span className="text-xs text-emerald-400 ml-3">{board.source} · {board.url.startsWith('/') ? 'Full table' : 'External'}</span><p className="text-xs text-zinc-500 mt-1">{board.description}</p>
    </a>)}</div>
    <p className="text-xs text-zinc-500">OCR, audio understanding, and video understanding now have score tables inside Radar. Image restoration, sound generation, speech enhancement, and scientific models still need dedicated coverage; other task rankings are not substitutes.</p>
  </div>;
}
