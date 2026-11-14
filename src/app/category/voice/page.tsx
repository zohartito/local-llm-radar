import { redirect } from 'next/navigation';

// Speech evidence must never fall through into text category rankings.
export default function CategoryVoiceRedirect() {
  redirect('/voice');
}
