import { redirect } from 'next/navigation';

// /category/video used to fall through to the text overall ranking while
// keeping the fake "video Leaderboard" title. Video lives at /video.
export default function CategoryVideoRedirect() {
  redirect('/video');
}
