// Workers has no real filesystem, but pdfkit and its font/line-breaking
// dependencies read data files next to their own source at import time
// (`fs.readFileSync(__dirname + '/data/Helvetica.afm')` and friends).
// wrangler.jsonc aliases the bare "fs" module to this file, which serves
// those reads from copies bundled into the Worker and passes everything
// else through to Workers' node:fs.
import * as nodeFs from 'node:fs';
import { Buffer } from 'node:buffer';

import helvetica from '@foliojs-fork/pdfkit/js/data/Helvetica.afm';
import helveticaBold from '@foliojs-fork/pdfkit/js/data/Helvetica-Bold.afm';
import helveticaOblique from '@foliojs-fork/pdfkit/js/data/Helvetica-Oblique.afm';
import helveticaBoldOblique from '@foliojs-fork/pdfkit/js/data/Helvetica-BoldOblique.afm';
import fontkitData from '@foliojs-fork/fontkit/data.trie';
import fontkitIndic from '@foliojs-fork/fontkit/indic.trie';
import fontkitUse from '@foliojs-fork/fontkit/use.trie';
import linebreakClasses from '@foliojs-fork/linebreak/src/classes.trie';

const bundled: Record<string, ArrayBuffer> = {
  'Helvetica.afm': helvetica,
  'Helvetica-Bold.afm': helveticaBold,
  'Helvetica-Oblique.afm': helveticaOblique,
  'Helvetica-BoldOblique.afm': helveticaBoldOblique,
  'data.trie': fontkitData,
  'indic.trie': fontkitIndic,
  'use.trie': fontkitUse,
  'classes.trie': linebreakClasses,
};

export * from 'node:fs';

export function readFileSync(path: unknown, options?: unknown): unknown {
  if (typeof path === 'string') {
    const data = bundled[path.split(/[\/]/).pop()!];
    if (data) {
      const encoding = typeof options === 'string' ? options : (options as { encoding?: string } | undefined)?.encoding;
      const buf = Buffer.from(data);
      return encoding ? buf.toString(encoding as BufferEncoding) : buf;
    }
  }
  return (nodeFs.readFileSync as (...args: unknown[]) => unknown)(path, options);
}

export default { ...nodeFs, readFileSync };
