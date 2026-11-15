import { atCapstone } from './test-support';

/**
 * Every capstone solved in at least two different valid ways. Goals check
 * the world, so any sensible route must win.
 */
const solutions: Record<string, string[][]> = {
  'apprentice-cells': [
    ['cd /', 'cd archive', 'cd echo-hall', 'cd atrium', 'ls'],
    ['cd /', 'cd /archive', 'cd /archive/echo-hall', 'cd atrium/', 'ls -a'],
  ],
  'reading-room': [
    [
      'tail /archive/reading-room/archivists-journal',
      'cat /archive/reading-room/back-shelf/.sealed-tome',
    ],
    [
      'cd /archive/reading-room',
      'less archivists-journal',
      'cd back-shelf',
      'ls -a',
      'head -n 50 .sealed-tome',
    ],
  ],
  bindery: [
    [
      'mkdir -p /archive/bindery/shelf/fiction/tales /archive/bindery/shelf/poetry',
      'mv /archive/bindery/loose-pages/tale-* /archive/bindery/shelf/fiction/tales/',
      'mv /archive/bindery/loose-pages/poem-* /archive/bindery/shelf/poetry/',
      'mkdir /archive/bindery/quarantine',
      'mv /archive/bindery/loose-pages/*.lx /archive/bindery/quarantine/',
    ],
    [
      // Copy instead of move, one page at a time, relative paths.
      'cd /archive/bindery',
      'mkdir shelf',
      'mkdir shelf/fiction shelf/poetry',
      'mkdir shelf/fiction/tales',
      'cp loose-pages/tale-of-the-moth loose-pages/tale-of-the-salt loose-pages/tale-of-the-bell shelf/fiction/tales',
      'cp loose-pages/poem-of-rain shelf/poetry/',
      'cp loose-pages/poem-of-ink shelf/poetry/',
      'mkdir quarantine',
      'cd loose-pages',
      'mv fragment-?.lx ../quarantine',
    ],
  ],
  observatory: [
    [
      'grep -rl "Oriel Vane" /archive/observatory/star-charts',
      'mkdir /archive/observatory/true-name',
      'mv /archive/observatory/star-charts/chart-7 /archive/observatory/star-charts/chart-23 /archive/observatory/star-charts/chart-41 /archive/observatory/star-charts/chart-58 /archive/observatory/true-name/',
    ],
    [
      // Search with -n and -w, then copy one at a time from inside the room.
      'cd /archive/observatory/star-charts',
      'grep -nw Vane *',
      'mkdir ../true-name',
      'cp chart-7 ../true-name',
      'cp chart-23 chart-41 ../true-name/',
      'cp chart-58 /archive/observatory/true-name',
    ],
  ],
  aqueducts: [
    [
      'cat /archive/aqueducts/channels/* 2> /dev/null | grep -v lionX | sort > /archive/aqueducts/clean-record',
    ],
    [
      // Channel by channel into a scratch book, then sort it into place.
      'cd /archive/aqueducts/channels',
      'grep -v lionX north > /tmp-clean 2>/dev/null || grep -v lionX north > ~/scratch',
      'grep -v lionX south >> ~/scratch',
      'sort < ~/scratch > /archive/aqueducts/clean-record',
    ],
  ],
  vault: [
    [
      'sudo chown -R archivist:apprentice /archive/vault/inner',
      'sudo chmod 750 /archive/vault/inner',
      'sudo chmod 640 /archive/vault/inner/archivists-seal',
      'cat /archive/vault/inner/archivists-seal',
    ],
    [
      // Symbolic modes, owner and group separately, and read with head.
      'sudo chown archivist /archive/vault/inner /archive/vault/inner/archivists-seal',
      'sudo chown :apprentice /archive/vault/inner /archive/vault/inner/archivists-seal',
      'sudo chmod g+rx,o-rwx /archive/vault/inner',
      'sudo chmod g+r /archive/vault/inner/archivists-seal',
      'head -n 1 /archive/vault/inner/archivists-seal',
    ],
  ],
  'haunted-stacks': [
    ['sudo pkill -STOP lionX', 'sudo pkill -9 gnawer'],
    [
      // By PID, with kill; first try (and fail) without freezing lionX.
      'ps aux',
      'sudo kill -9 4666',
      'pgrep -l gnawer',
      'sudo kill -STOP 666',
      'sudo pkill -KILL -x gnawer',
    ],
  ],
  undercroft: [
    [
      "echo 'export PATH=/usr/local/bin:/usr/bin:/bin' > ~/.bashrc",
      'source ~/.bashrc',
      'grep lionX /archive/undercroft/foundation-stone-log',
    ],
    [
      // Fix the running shell first, then the file with cp from a clean copy, then read it with `.`.
      'export PATH=/usr/bin:/bin',
      "echo 'export PATH=/usr/bin:/bin:/usr/local/bin' > /archive/undercroft/workroom/clean-rc",
      'cp /archive/undercroft/workroom/clean-rc ~/.bashrc',
      'grep -c hums /archive/undercroft/foundation-stone-log',
    ],
  ],
  root: [
    [
      "echo '#!/bin/bash' > ~/ritual.sh",
      "echo 'sudo crontab -r -u lionx' >> ~/ritual.sh",
      "echo 'sudo pkill -9 lionX' >> ~/ritual.sh",
      "echo 'sudo chown -R archivist:apprentice /archive/root/heart' >> ~/ritual.sh",
      "echo 'sudo chmod -R g+rX,o-rwx /archive/root/heart' >> ~/ritual.sh",
      'chmod +x ~/ritual.sh',
      '~/ritual.sh',
    ],
    [
      // Octal modes, kill by PID, a loop inside the ritual, run as ./ritual.sh from home.
      'cd ~',
      "echo '#!/bin/bash' > ritual.sh",
      "echo 'sudo crontab -u lionx -r' >> ritual.sh",
      "echo 'sudo kill -9 666' >> ritual.sh",
      "echo 'for p in /archive/root/heart /archive/root/heart/foundation-stone; do sudo chown archivist:apprentice $p; done' >> ritual.sh",
      "echo 'sudo chmod 750 /archive/root/heart' >> ritual.sh",
      "echo 'sudo chmod 640 /archive/root/heart/foundation-stone' >> ritual.sh",
      'chmod 700 ritual.sh',
      './ritual.sh',
    ],
  ],
};

describe('capstones can be solved more than one way', () => {
  const cases = Object.entries(solutions).flatMap(([wing, ways]) =>
    ways.map((w, i) => [wing, i + 1, w] as const),
  );
  it.each(cases)('%s, way %i', async (wing, _i, lines) => {
    const { runner, type } = atCapstone(wing);
    for (const line of lines) {
      expect(runner.done, `finished early, before: ${line}`).toBe(false);
      await type(line);
    }
    expect(runner.done).toBe(true);
  });

  it('has two ways for every capstone written so far', async () => {
    const { wingChain } = await import('./test-support');
    for (const w of wingChain())
      expect(solutions[w.id]?.length ?? 0, w.id).toBeGreaterThanOrEqual(2);
  });
});
