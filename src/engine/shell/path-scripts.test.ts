import { createRegistry } from '../commands';
import { DEFAULT_PATH, installSpells } from '../session';
import { buildWorld } from '../vfs';
import { Shell } from './executor';

function setup() {
  const vfs = buildWorld({
    user: { name: 'apprentice', groups: ['apprentice'], home: '/home/apprentice' },
    files: {
      '/home/apprentice/greet.sh': {
        content: '#!/bin/sh\necho "hello $1, you gave $# words: $@"\ncd /\nexit 3\necho never\n',
        mode: '755',
      },
      '/home/apprentice/noexec.sh': '#!/bin/sh\necho hi\n',
      '/home/apprentice/vars.sh': { content: 'SECRET=kept\nexport SHARED=yes\n', mode: '644' },
      '/opt/tools/bin/kindle': { content: '#!/bin/sh\necho kindled\n', mode: '755' },
    },
  });
  let out = '';
  let err = '';
  const shell = new Shell({
    vfs,
    registry: createRegistry(),
    terminal: { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } },
    env: { PATH: DEFAULT_PATH },
  });
  installSpells(vfs, shell.registry);
  const run = async (line: string) => {
    out = '';
    err = '';
    const status = await shell.run(line);
    return { out, err, status };
  };
  return { shell, vfs, run };
}

describe('PATH lookup', () => {
  it('finds spells in /usr/bin and builtins inside the shell', async () => {
    const g = setup();
    expect((await g.run('which ls')).out).toBe('/usr/bin/ls\n');
    expect((await g.run('type cd ls')).out).toBe('cd is a shell builtin\nls is /usr/bin/ls\n');
    expect((await g.run('which cd')).status).toBe(1);
  });

  it('a broken PATH loses spells but keeps builtins', async () => {
    const g = setup();
    await g.run('export PATH=/nowhere');
    expect(await g.run('ls')).toEqual({
      out: '',
      err: 'bash: ls: command not found\n',
      status: 127,
    });
    expect((await g.run('echo still here')).out).toBe('still here\n');
    expect((await g.run('/usr/bin/ls /opt')).out).toBe('tools\n');
  });

  it('later PATH entries are searched in order', async () => {
    const g = setup();
    expect((await g.run('kindle')).status).toBe(127);
    await g.run('export PATH=$PATH:/opt/tools/bin');
    expect((await g.run('kindle')).out).toBe('kindled\n');
  });

  it('paths with a slash: missing, directories, and non-executables', async () => {
    const g = setup();
    expect((await g.run('./nope')).err).toBe('bash: ./nope: No such file or directory\n');
    expect((await g.run('/opt')).err).toBe('bash: /opt: Is a directory\n');
    const r = await g.run('./noexec.sh');
    expect(r).toEqual({ out: '', err: 'bash: ./noexec.sh: Permission denied\n', status: 126 });
  });
});

describe('scripts', () => {
  it('get $1, $#, $@; exit ends only the script; cd inside does not move you', async () => {
    const g = setup();
    const r = await g.run('./greet.sh Mira and Tobin');
    expect(r.out).toBe('hello Mira, you gave 3 words: Mira and Tobin\n');
    expect(r.status).toBe(3);
    expect(g.vfs.cwd).toBe('/home/apprentice');
    expect((await g.run('echo $?')).out).toBe('3\n');
  });

  it('run in their own variables; source runs in yours', async () => {
    const g = setup();
    await g.run('chmod +x vars.sh');
    await g.run('./vars.sh');
    expect((await g.run('echo [$SECRET]')).out).toBe('[]\n');
    await g.run('source vars.sh');
    expect((await g.run('echo [$SECRET]')).out).toBe('[kept]\n');
    expect((await g.run('printenv SHARED')).out).toBe('yes\n');
    expect((await g.run('printenv SECRET')).status).toBe(1);
    expect((await g.run('. missing')).err).toBe('bash: missing: No such file or directory\n');
  });

  it('multi-line input runs line by line, with comments', async () => {
    const g = setup();
    expect((await g.run('echo one # not this\necho two\n\necho three')).out).toBe(
      'one\ntwo\nthree\n',
    );
    expect((await g.run('echo a |\nwc -l')).out).toBe('1\n');
  });
});

describe('aliases and the environment', () => {
  it('alias, list, use, type, unalias', async () => {
    const g = setup();
    await g.run("alias ll='ls -a'");
    expect((await g.run('alias')).out).toBe("alias ll='ls -a'\n");
    expect((await g.run('ll /opt')).out).toBe('.\n..\ntools\n');
    expect((await g.run('type ll')).out).toBe("ll is aliased to `ls -a'\n");
    await g.run('unalias ll');
    expect((await g.run('ll')).status).toBe(127);
    expect((await g.run('unalias ll')).err).toBe('bash: unalias: ll: not found\n');
  });

  it('export marks variables for the environment', async () => {
    const g = setup();
    await g.run('PLAIN=1; export SHOWN=2');
    const env = (await g.run('env')).out;
    expect(env).toContain('SHOWN=2\n');
    expect(env).not.toContain('PLAIN=');
    expect((await g.run('export')).out).toContain('declare -x SHOWN="2"\n');
    expect((await g.run('export 1bad=x')).err).toBe(
      "bash: export: `1bad=x': not a valid identifier\n",
    );
  });
});

describe('loops and conditions', () => {
  it('for loops over words and globs, and set the variable', async () => {
    const g = setup();
    expect((await g.run('for n in 1 2 3; do echo candle-$n; done')).out).toBe(
      'candle-1\ncandle-2\ncandle-3\n',
    );
    expect((await g.run('for f in /opt/tools/bin/*; do echo found $f; done')).out).toBe(
      'found /opt/tools/bin/kindle\n',
    );
    await g.run('mkdir -p ~/c; for n in a b; do touch ~/c/$n; done');
    expect((await g.run('ls ~/c')).out).toBe('a\nb\n');
  });

  it('if picks the first branch whose condition succeeds', async () => {
    const g = setup();
    expect(
      (await g.run('if false; then echo a; elif true; then echo b; else echo c; fi')).out,
    ).toBe('b\n');
    expect((await g.run('if ls /nope 2>/dev/null; then echo yes; else echo no; fi')).out).toBe(
      'no\n',
    );
    expect((await g.run('if false; then echo a; fi; echo $?')).out).toBe('0\n');
  });

  it('loops can be piped and span lines', async () => {
    const g = setup();
    expect((await g.run('for w in b a c; do echo $w; done | sort')).out).toBe('a\nb\nc\n');
    expect((await g.run('for w in x y\ndo\n  echo [$w]\ndone')).out).toBe('[x]\n[y]\n');
  });
});
