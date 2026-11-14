import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Hardware Fit — Local LLM Radar',
  description: 'Find the best practical local models for a Mac, PC GPU stack, CPU-only machine, or edge device.',
};

export default function HardwareLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
