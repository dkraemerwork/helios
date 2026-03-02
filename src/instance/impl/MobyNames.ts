/**
 * TypeScript port of the Moby Project random name generator (https://github.com/moby/moby).
 * Original work Copyright 2019 The Moby Project.
 * Modified work Copyright (c) 2008-2026, Hazelcast, Inc.
 */

const LEFT: string[] = [
  'admiring', 'adoring', 'affectionate', 'agitated', 'amazing', 'angry', 'awesome',
  'blissful', 'boring', 'brave', 'charming', 'clever', 'cool', 'compassionate',
  'competent', 'condescending', 'confident', 'cranky', 'crazy', 'dazzling', 'determined',
  'distracted', 'dreamy', 'eager', 'ecstatic', 'elastic', 'elated', 'elegant', 'eloquent',
  'epic', 'fervent', 'festive', 'flamboyant', 'focused', 'friendly', 'frosty', 'gallant',
  'gifted', 'goofy', 'gracious', 'happy', 'hardcore', 'heuristic', 'hopeful', 'hungry',
  'infallible', 'inspiring', 'jolly', 'jovial', 'keen', 'kind', 'laughing', 'loving',
  'lucid', 'magical', 'mystifying', 'modest', 'musing', 'naughty', 'nervous', 'nifty',
  'nostalgic', 'objective', 'optimistic', 'peaceful', 'pedantic', 'pensive', 'practical',
  'priceless', 'quirky', 'quizzical', 'recursing', 'relaxed', 'reverent', 'romantic',
  'sad', 'serene', 'sharp', 'silly', 'sleepy', 'stoic', 'stupefied', 'suspicious',
  'sweet', 'tender', 'thirsty', 'trusting', 'unruffled', 'upbeat', 'vibrant', 'vigilant',
  'vigorous', 'wizardly', 'wonderful', 'xenodochial', 'youthful', 'zealous', 'zen',
];

const RIGHT: string[] = [
  'albattani', 'allen', 'almeida', 'antonelli', 'agnesi', 'archimedes', 'ardinghelli',
  'aryabhata', 'austin', 'babbage', 'banach', 'banzai', 'bardeen', 'bartik', 'bassi',
  'beaver', 'bell', 'benz', 'bhabha', 'bhaskara', 'black', 'blackburn', 'blackwell',
  'bohr', 'booth', 'borg', 'bose', 'bouman', 'boyd', 'brahmagupta', 'brattain', 'brown',
  'burnell', 'buck', 'cannon', 'carson', 'cartwright', 'carver', 'cerf', 'chandrasekhar',
  'chaplygin', 'chatelet', 'chatterjee', 'chebyshev', 'clifford', 'cohen', 'chaum',
  'clarke', 'colden', 'cori', 'cray', 'curran', 'curie', 'darwin', 'davinci', 'dewdney',
  'dhawan', 'diffie', 'dijkstra', 'dirac', 'driscoll', 'dubinsky', 'easley', 'edison',
  'einstein', 'elbakyan', 'elgamal', 'elion', 'ellis', 'engelbart', 'euclid', 'euler',
  'faraday', 'feistel', 'fermat', 'fermi', 'feynman', 'franklin', 'gagarin', 'galileo',
  'galois', 'ganguly', 'gates', 'gauss', 'germain', 'goldberg', 'goldstine', 'goldwasser',
  'golick', 'goodall', 'gould', 'greider', 'grothendieck', 'haibt', 'hamilton', 'haslett',
  'hawking', 'hellman', 'heisenberg', 'hermann', 'herschel', 'hertz', 'heyrovsky',
  'hodgkin', 'hofstadter', 'hoover', 'hopper', 'hugle', 'hypatia', 'ishizaka', 'jackson',
  'jang', 'jemison', 'jennings', 'jepsen', 'johnson', 'joliot', 'jones', 'kalam',
  'kapitsa', 'kare', 'keldysh', 'keller', 'kepler', 'khayyam', 'khorana', 'kilby',
  'kirch', 'knuth', 'kowalevski', 'lalande', 'lamarr', 'lamport', 'leakey', 'leavitt',
  'lederberg', 'lehmann', 'lewin', 'lichterman', 'liskov', 'lovelace', 'lumiere',
  'mahavira', 'margulis', 'matsumoto', 'maxwell', 'mayer', 'mccarthy', 'mcclintock',
  'mclaren', 'mclean', 'mcnulty', 'mendel', 'mendeleev', 'meitner', 'meninsky', 'merkle',
  'mestorf', 'minsky', 'mirzakhani', 'moore', 'morse', 'murdock', 'moser', 'napier',
  'nash', 'neumann', 'newton', 'nightingale', 'nobel', 'noether', 'northcutt', 'noyce',
  'panini', 'pare', 'pascal', 'pasteur', 'payne', 'perlman', 'pike', 'poincare',
  'poitras', 'proskuriakova', 'ptolemy', 'raman', 'ramanujan', 'ride', 'montalcini',
  'ritchie', 'rhodes', 'robinson', 'roentgen', 'rosalind', 'rubin', 'saha', 'sammet',
  'sanderson', 'satoshi', 'shamir', 'shannon', 'shaw', 'shirley', 'shockley', 'shtern',
  'sinoussi', 'snyder', 'solomon', 'spence', 'sutherland', 'stallman', 'stonebraker',
  'swanson', 'swartz', 'swirles', 'taussig', 'tereshkova', 'tesla', 'tharp', 'thompson',
  'torvalds', 'tu', 'turing', 'varahamihira', 'vaughan', 'visvesvaraya', 'volhard',
  'villani', 'wescoff', 'wilbur', 'wiles', 'williams', 'williamson', 'wilson', 'wing',
  'wozniak', 'wright', 'wu', 'yalow', 'yonath', 'zhukovsky',
];

// Shuffle arrays at module load (matching Java static initializer behavior)
function shuffle(arr: string[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

shuffle(LEFT);
shuffle(RIGHT);

export class MobyNames {
  static readonly MOBY_NAMING_PREFIX = 'hazelcast.internal.member.naming.moby.prefix';

  private constructor() {}

  /**
   * Returns a name formatted as "adjective_surname" (or "prefix_adjective_surname").
   * Repeated calls with the same number are stable within a process lifetime.
   */
  static getRandomName(number: number): string {
    const combinationIdx = number % (LEFT.length * RIGHT.length);
    const rightIdx = Math.floor(combinationIdx / LEFT.length);
    const leftIdx = combinationIdx % LEFT.length;
    let name = `${LEFT[leftIdx]}_${RIGHT[rightIdx]}`;
    const prefix = process.env[MobyNames.MOBY_NAMING_PREFIX];
    if (prefix != null) {
      name = prefix + '_' + name;
    }
    return name;
  }
}
