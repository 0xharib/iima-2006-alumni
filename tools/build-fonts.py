"""Rebuild fonts.mjs inputs: subset web fonts and measure fallback metrics.

Usage (Python 3 with fonttools and brotli):
  mkdir pkgs && cd pkgs
  for p in @fontsource-variable/source-serif-4 @fontsource-variable/source-sans-3 @fontsource/ibm-plex-mono \
           @fontsource/tiro-devanagari-sanskrit @fontsource/tinos @fontsource/arimo; do npm pack "$p"; done
  for f in *.tgz; do mkdir "${f%.tgz}" && tar -xzf "$f" -C "${f%.tgz}"; done; cd ..
  python3 tools/build-fonts.py pkgs out
Then base64 the five .woff2 files in out/ into fonts.mjs, and copy the numbers in out/fallback.json into the
"Fallback" @font-face rules in theme.mjs.
"""
import glob, os, json, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

P = sys.argv[1].rstrip('/') + '/'
OUT = sys.argv[2].rstrip('/') + '/'
os.makedirs(OUT, exist_ok=True)
pick = lambda pat: glob.glob(P + pat)[0]

def instance(src, axes, dst):
    f = instancer.instantiateVariableFont(TTFont(src), axes)
    f.flavor = 'woff2'; f.save(OUT + dst)

instance(pick('fontsource-variable-source-serif-4-*/package/files/source-serif-4-latin-opsz-normal.woff2'),
         {'wght': (400, 750), 'opsz': (20, 60)}, 'source-serif-4.woff2')
instance(pick('fontsource-variable-source-serif-4-*/package/files/source-serif-4-latin-wght-italic.woff2'),
         {'wght': (400, 700)}, 'source-serif-4-italic.woff2')
instance(pick('fontsource-variable-source-sans-3-*/package/files/source-sans-3-latin-wght-normal.woff2'),
         {'wght': (400, 700)}, 'source-sans-3.woff2')
mono = TTFont(pick('fontsource-ibm-plex-mono-*/package/files/ibm-plex-mono-latin-500-normal.woff2'))
mono.flavor = 'woff2'; mono.save(OUT + 'plex-mono-500.woff2')

# Devanagari: only the institute motto, so a few KB instead of 179 KB.
motto = 'विद्याविनियोगाद्विकासः'
opts = subset.Options(); opts.layout_features = ['*']; opts.flavor = 'woff2'; opts.hinting = False; opts.desubroutinize = True; opts.name_IDs = [1, 2, 3, 4, 6]; opts.notdef_outline = True
sub = subset.Subsetter(opts); deva = TTFont(pick('fontsource-tiro-devanagari-sanskrit-*/package/files/tiro-devanagari-sanskrit-devanagari-400-normal.woff2'))
sub.populate(text=motto + ' '); sub.subset(deva); deva.flavor = 'woff2'; deva.save(OUT + 'tiro-devanagari-motto.woff2')

# Fallback metrics (the approach Next.js uses): match average glyph width on real prose, then line metrics.
sample = ("Tikli has been one of my closest friends since day one at Ahmedabad. Confident, intimidating, inspiring "
          "and fun, all at the same time. Twenty years since LKP. Find your batchmates, trade the old stories, and see "
          "you in Jaipur. WIMWIans are looking to catch up with you. Lying on the LKP lawns late at night, dew soaking "
          "through my shirt, looking up at the red brick and a cloudy sky. Section D, Dorm 4, PGP 2004-06.")
def avg_width(font):
    cmap, hmtx, upm = font.getBestCmap(), font['hmtx'], font['head'].unitsPerEm
    widths = [hmtx[cmap[ord(c)]][0] for c in sample if ord(c) in cmap]
    return sum(widths) / len(widths) / upm
def metrics(path, axes):
    f = TTFont(path)
    if 'fvar' in f: f = instancer.instantiateVariableFont(f, axes)
    h, upm = f['hhea'], f['head'].unitsPerEm
    return avg_width(f), h.ascent / upm, -h.descent / upm, h.lineGap / upm
out = {}
for name, path, axes, fallback in [
    ('serif', OUT + 'source-serif-4.woff2', {'wght': 400, 'opsz': 20}, pick('fontsource-tinos-*/package/files/tinos-latin-400-normal.woff2')),
    ('sans', OUT + 'source-sans-3.woff2', {'wght': 400}, pick('fontsource-arimo-*/package/files/arimo-latin-400-normal.woff2')),
]:
    w, asc, desc, gap = metrics(path, axes); fw = metrics(fallback, {})[0]
    size = w / fw
    out[name] = {'size-adjust': f'{size*100:.2f}%', 'ascent-override': f'{asc/size*100:.2f}%',
                 'descent-override': f'{desc/size*100:.2f}%', 'line-gap-override': f'{gap/size*100:.2f}%'}
json.dump(out, open(OUT + 'fallback.json', 'w'), indent=1)
for f in sorted(os.listdir(OUT)): print(f'{f:32} {os.path.getsize(OUT+f)/1024:6.1f} KB')
print(json.dumps(out, indent=1))
