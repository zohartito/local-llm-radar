/** Navigation only: a family selects a leaderboard, never combines its scores. */
export const MODEL_FAMILIES = [
  { id: 'text', label: 'Text / LLMs', href: '/', options: [
    { label: 'All', href: '/' }, { label: 'Coding', href: '/category/coding' },
    { label: 'Reasoning', href: '/category/reasoning' }, { label: 'Math', href: '/category/math' },
    { label: 'Chat', href: '/category/chat' }, { label: 'Agents & tools', href: '/category/agentic' },
  ] },
  { id: 'embeddings', label: 'Embeddings', href: '/embeddings', options: [] },
  { id: 'rerankers', label: 'Rerankers', href: '/leaderboards/rerankers', options: [] },
  { id: 'ocr', label: 'OCR', href: '/leaderboards/document-parsing', options: [
    { label: 'PDF / document parsing', href: '/leaderboards/document-parsing' },
    { label: 'Read & understand · English', href: '/leaderboards/ocr' },
    { label: 'Read & understand · Chinese', href: '/leaderboards/ocr-chinese' },
  ] },
  { id: 'vision', label: 'Vision', href: '/leaderboards/vision', options: [
    { label: 'Image understanding', href: '/leaderboards/vision' },
  ] },
  { id: 'detection', label: 'Detection', href: '/leaderboards/object-detection', options: [
    { label: 'Real-time models · COCO val', href: '/leaderboards/object-detection' }, { label: 'COCO test-dev · archive', href: '/leaderboards/detection-coco' },
  ] },
  { id: 'segmentation', label: 'Segmentation', href: '/leaderboards/image-segmentation', options: [
    { label: 'Instance masks · COCO val', href: '/leaderboards/image-segmentation' }, { label: 'Instance masks · archive', href: '/leaderboards/segmentation-coco' }, { label: 'Panoptic · archive', href: '/leaderboards/panoptic-segmentation' },
  ] },
  { id: 'depth', label: 'Depth', href: '/leaderboards/depth-estimation', options: [] },
  { id: 'video', label: 'Video', href: '/leaderboards/video-understanding', options: [
    { label: 'Understand video', href: '/leaderboards/video-understanding' },
    { label: 'Understand video · subtitles', href: '/leaderboards/video-understanding-subtitles' },
    { label: 'Local hardware fit', href: '/video' },
  ] },
  { id: 'speech', label: 'Audio & speech', href: '/leaderboards/audio-understanding', options: [
    { label: 'Audio understanding', href: '/leaderboards/audio-understanding' },
    { label: 'Audio understanding · mini', href: '/leaderboards/audio-understanding-mini' },
    { label: 'Voice assistants / local fit', href: '/voice' },
  ] },
  { id: '3d', label: '3D', href: '/leaderboards/3d-generation', options: [] },
  { id: 'more', label: 'More', href: '/leaderboards/more', options: [] },
];

export function modelFamilyForPath(pathname: string) {
  if (pathname === '/category/voice') return MODEL_FAMILIES.find(family => family.id === 'speech');
  if (pathname === '/' || pathname === '/text' || pathname.startsWith('/category/')) return MODEL_FAMILIES[0];
  if (pathname === '/embeddings' || ['/leaderboards/embeddings', '/leaderboards/embeddings-english', '/leaderboards/code-embeddings', '/leaderboards/image-embeddings', '/leaderboards/audio-embeddings', '/leaderboards/video-embeddings', '/leaderboards/document-retrieval'].includes(pathname)) return MODEL_FAMILIES[1];
  return MODEL_FAMILIES.find(family => family.href === pathname || family.options.some(option => option.href === pathname));
}
