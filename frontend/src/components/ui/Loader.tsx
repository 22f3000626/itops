import { motion } from 'framer-motion';

export default function Loader({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <motion.div
        className="w-10 h-10 rounded-full border-2 border-accent/30 border-t-accent"
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      />
      <span className="text-sm text-slate-400">{text}</span>
    </div>
  );
}
