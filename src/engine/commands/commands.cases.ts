/**
 * Command snippets with expected stdout/stderr/status for non-terminal
 * output (as when piped). Expectations match GNU coreutils 9.4 and Bash 5.2,
 * cross-checked against the real tools on a mirror of the test world.
 * Cases marked `game` depend on game-only state (users, the vault) and were
 * written by hand from the real tools' message formats.
 */
export interface CommandCase {
  cmd: string;
  out?: string;
  err?: string;
  status?: number;
  game?: boolean;
}

const journal = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `entry ${from + i}\n`).join('');

export const commandCases: CommandCase[] = [
  // pwd
  { cmd: 'pwd', out: '/home/apprentice\n', status: 0 },
  { cmd: 'pwd -L', out: '/home/apprentice\n' },
  { cmd: 'pwd -P', out: '/home/apprentice\n' },
  { cmd: 'pwd extra', out: '/home/apprentice\n', status: 0 },
  { cmd: 'pwd -z', err: 'bash: pwd: -z: invalid option\npwd: usage: pwd [-LP]\n', status: 2 },

  // cd
  { cmd: 'cd notes; pwd', out: '/home/apprentice/notes\n' },
  { cmd: 'cd notes/; pwd', out: '/home/apprentice/notes\n' },
  { cmd: 'cd ..; pwd', out: '/home\n' },
  { cmd: 'cd ../..; pwd', out: '/\n', game: true },
  { cmd: 'cd /; cd ..; pwd', out: '/\n' },
  { cmd: 'cd notes; cd; pwd', out: '/home/apprentice\n' },
  { cmd: 'cd notes; cd ~; pwd', out: '/home/apprentice\n' },
  { cmd: 'cd ~/../apprentice/notes/.; pwd', out: '/home/apprentice/notes\n' },
  { cmd: 'cd notes; cd -', out: '/home/apprentice\n' },
  { cmd: 'cd -', err: 'bash: cd: OLDPWD not set\n', status: 1, game: true },
  { cmd: 'cd notes; echo $OLDPWD $PWD', out: '/home/apprentice /home/apprentice/notes\n' },
  { cmd: 'cd nowhere', err: 'bash: cd: nowhere: No such file or directory\n', status: 1 },
  { cmd: 'cd letter.txt', err: 'bash: cd: letter.txt: Not a directory\n', status: 1 },
  { cmd: 'cd notes atrium', err: 'bash: cd: too many arguments\n', status: 1 },
  { cmd: 'cd ""; pwd', out: '/home/apprentice\n' },
  { cmd: 'cd /vault', err: 'bash: cd: /vault: Permission denied\n', status: 1, game: true },
  { cmd: 'cd notes && pwd || echo failed', out: '/home/apprentice/notes\n' },
  {
    cmd: 'cd nope || echo failed',
    out: 'failed\n',
    err: 'bash: cd: nope: No such file or directory\n',
  },

  // cat
  { cmd: 'cat letter.txt', out: 'Dear apprentice,\nthe stacks are failing.\n' },
  { cmd: 'cat notes/page1 notes/page2', out: 'one\ntwo\n' },
  { cmd: 'cat empty.txt', out: '' },
  { cmd: 'cat no-newline.txt', out: 'first\nlast line' },
  { cmd: 'echo poured | cat', out: 'poured\n' },
  { cmd: 'echo mid | cat notes/page1 - notes/page2', out: 'one\nmid\ntwo\n' },
  { cmd: 'cat < letter.txt', out: 'Dear apprentice,\nthe stacks are failing.\n' },
  { cmd: 'cat -n letter.txt', out: '     1\tDear apprentice,\n     2\tthe stacks are failing.\n' },
  { cmd: 'cat -n notes/page1 notes/page2', out: '     1\tone\n     2\ttwo\n' },
  { cmd: 'cat -b blanks.txt', out: '     1\ta\n\n\n\n     2\tb\n' },
  { cmd: 'cat -n blanks.txt', out: '     1\ta\n     2\t\n     3\t\n     4\t\n     5\tb\n' },
  { cmd: 'cat -s blanks.txt', out: 'a\n\nb\n' },
  { cmd: 'cat -sn blanks.txt', out: '     1\ta\n     2\t\n     3\tb\n' },
  { cmd: 'cat -E letter.txt', out: 'Dear apprentice,$\nthe stacks are failing.$\n' },
  { cmd: 'cat -n no-newline.txt', out: '     1\tfirst\n     2\tlast line' },
  { cmd: 'cat "two words.txt"', out: 'spaced\n' },
  { cmd: 'cat .sealed-tome', out: 'hidden\n' },
  { cmd: 'cat missing', err: 'cat: missing: No such file or directory\n', status: 1 },
  { cmd: 'cat notes', err: 'cat: notes: Is a directory\n', status: 1 },
  {
    cmd: 'cat missing notes/page1',
    out: 'one\n',
    err: 'cat: missing: No such file or directory\n',
    status: 1,
  },
  { cmd: 'cat /vault/seal', err: 'cat: /vault/seal: Permission denied\n', status: 1, game: true },
  {
    cmd: 'cat -z x',
    err: "cat: invalid option -- 'z'\nTry 'cat --help' for more information.\n",
    status: 1,
  },
  {
    cmd: 'cat --nope',
    err: "cat: unrecognized option '--nope'\nTry 'cat --help' for more information.\n",
    status: 1,
  },
  {
    cmd: 'cat --num letter.txt',
    err: "cat: option '--num' is ambiguous; possibilities: '--number-nonblank' '--number'\nTry 'cat --help' for more information.\n",
    status: 1,
  },
  {
    cmd: 'cat --number letter.txt',
    out: '     1\tDear apprentice,\n     2\tthe stacks are failing.\n',
  },
  { cmd: 'cat -- -n', err: 'cat: -n: No such file or directory\n', status: 1 },

  // head
  { cmd: 'head journal.txt', out: journal(1, 10) },
  { cmd: 'head -n 3 journal.txt', out: journal(1, 3) },
  { cmd: 'head -n3 journal.txt', out: journal(1, 3) },
  { cmd: 'head -3 journal.txt', out: journal(1, 3) },
  { cmd: 'head --lines=2 journal.txt', out: journal(1, 2) },
  { cmd: 'head --lines 2 journal.txt', out: journal(1, 2) },
  { cmd: 'head -n -12 journal.txt', out: journal(1, 3) },
  { cmd: 'head -n 0 journal.txt', out: '' },
  { cmd: 'head -n 99 letter.txt', out: 'Dear apprentice,\nthe stacks are failing.\n' },
  { cmd: 'head -n 1 no-newline.txt', out: 'first\n' },
  { cmd: 'head -n 5 no-newline.txt', out: 'first\nlast line' },
  { cmd: 'cat journal.txt | head -n 2', out: journal(1, 2) },
  {
    cmd: 'head -n 1 notes/page1 notes/page2',
    out: '==> notes/page1 <==\none\n\n==> notes/page2 <==\ntwo\n',
  },
  { cmd: 'head -q -n 1 notes/page1 notes/page2', out: 'one\ntwo\n' },
  { cmd: 'head -v -n 1 notes/page1', out: '==> notes/page1 <==\none\n' },
  { cmd: 'head -n x journal.txt', err: "head: invalid number of lines: 'x'\n", status: 1 },
  {
    cmd: 'head missing',
    err: "head: cannot open 'missing' for reading: No such file or directory\n",
    status: 1,
  },
  { cmd: 'head notes', err: "head: error reading 'notes': Is a directory\n", status: 1 },
  {
    cmd: 'head -n 1 notes/page1 missing notes/page2',
    out: '==> notes/page1 <==\none\n\n==> notes/page2 <==\ntwo\n',
    err: "head: cannot open 'missing' for reading: No such file or directory\n",
    status: 1,
  },
  {
    cmd: 'head -n',
    err: "head: option requires an argument -- 'n'\nTry 'head --help' for more information.\n",
    status: 1,
  },

  // tail
  { cmd: 'tail journal.txt', out: journal(6, 15) },
  { cmd: 'tail -n 2 journal.txt', out: journal(14, 15) },
  { cmd: 'tail -2 journal.txt', out: journal(14, 15) },
  { cmd: 'tail -n +14 journal.txt', out: journal(14, 15) },
  { cmd: 'tail +14 journal.txt', out: journal(14, 15) },
  { cmd: 'tail -n 0 journal.txt', out: '' },
  { cmd: 'tail -n 1 no-newline.txt', out: 'last line' },
  {
    cmd: 'tail -n 1 letter.txt notes/page1',
    out: '==> letter.txt <==\nthe stacks are failing.\n\n==> notes/page1 <==\none\n',
  },
  { cmd: 'cat journal.txt | tail -n 1', out: 'entry 15\n' },
  { cmd: 'head -n 5 journal.txt | tail -n 2', out: journal(4, 5) },
  {
    cmd: 'tail missing',
    err: "tail: cannot open 'missing' for reading: No such file or directory\n",
    status: 1,
  },
  { cmd: 'tail -n abc journal.txt', err: "tail: invalid number of lines: 'abc'\n", status: 1 },

  // ls (non-terminal output: one name per line, no quoting)
  {
    cmd: 'ls',
    out: 'big.txt\nblanks.txt\nempty.txt\njournal.txt\nletter.txt\nmany\nno-newline.txt\nnotes\nold.txt\nrun.sh\ntwo words.txt\n',
  },
  { cmd: 'ls notes', out: 'page1\npage2\n' },
  { cmd: 'ls notes/', out: 'page1\npage2\n' },
  { cmd: 'ls -a notes', out: '.\n..\npage1\npage2\n' },
  {
    cmd: 'ls -A',
    out: '.sealed-tome\nbig.txt\nblanks.txt\nempty.txt\njournal.txt\nletter.txt\nmany\nno-newline.txt\nnotes\nold.txt\nrun.sh\ntwo words.txt\n',
  },
  { cmd: 'ls -r notes', out: 'page2\npage1\n' },
  {
    cmd: 'ls -F',
    out: 'big.txt\nblanks.txt\nempty.txt\njournal.txt\nletter.txt\nmany/\nno-newline.txt\nnotes/\nold.txt\nrun.sh*\ntwo words.txt\n',
  },
  { cmd: 'ls -d notes', out: 'notes\n' },
  { cmd: 'ls -d', out: '.\n' },
  { cmd: 'ls letter.txt', out: 'letter.txt\n' },
  { cmd: 'ls notes/page1 letter.txt', out: 'letter.txt\nnotes/page1\n' },
  {
    cmd: 'ls notes many',
    out: 'many:\na\nbb\nccc\ndddd\neeeee\nffffff\nggggggg\nhhhhhhhh\niiiiiiiii\njjjjjjjjjj\nk1\nl22\nm333\nn4444\no55555\np666666\nq7777777\nr88888888\ns999999999\nt\n\nnotes:\npage1\npage2\n',
  },
  { cmd: 'ls letter.txt notes', out: 'letter.txt\n\nnotes:\npage1\npage2\n' },
  { cmd: 'ls ~/notes', out: 'page1\npage2\n' },
  { cmd: 'ls /home', out: 'apprentice\n', game: true },
  { cmd: 'ls missing', err: "ls: cannot access 'missing': No such file or directory\n", status: 2 },
  {
    cmd: 'ls missing notes',
    out: 'notes:\npage1\npage2\n',
    err: "ls: cannot access 'missing': No such file or directory\n",
    status: 2,
  },
  {
    cmd: 'ls /vault',
    err: "ls: cannot open directory '/vault': Permission denied\n",
    status: 2,
    game: true,
  },
  {
    cmd: 'ls -z',
    err: "ls: invalid option -- 'z'\nTry 'ls --help' for more information.\n",
    status: 2,
  },
  {
    cmd: 'ls --colour',
    err: "ls: unrecognized option '--colour'\nTry 'ls --help' for more information.\n",
    status: 2,
  },
  { cmd: 'ls --color=always notes', out: 'page1\npage2\n' },
  { cmd: 'ls --color=always -d notes', out: '\x1b[0m\x1b[01;34mnotes\x1b[0m\n' },
  { cmd: 'ls --color=always -d letter.txt', out: 'letter.txt\n' },
  {
    cmd: 'ls --color=sometimes',
    err: "ls: invalid argument 'sometimes' for '--color'\nValid arguments are:\n  - 'always', 'yes', 'force'\n  - 'never', 'no', 'none'\n  - 'auto', 'tty', 'if-tty'\nTry 'ls --help' for more information.\n",
    status: 1,
  },
  { cmd: 'ls | head -n 2', out: 'big.txt\nblanks.txt\n' },
  { cmd: 'ls -1 notes', out: 'page1\npage2\n' },
  { cmd: 'ls * | head -n 3', out: 'big.txt\nblanks.txt\nempty.txt\n' },

  // ls -l
  {
    cmd: 'ls -l notes',
    out:
      'total 8\n' +
      '-rw-r--r-- 1 apprentice apprentice 4 Nov 14 20:15 page1\n' +
      '-rw-r--r-- 1 apprentice apprentice 4 Nov 14 20:15 page2\n',
  },
  {
    cmd: 'ls -l letter.txt old.txt run.sh empty.txt big.txt',
    out:
      '-rw-r--r-- 1 apprentice apprentice 5000 Nov 14 20:15 big.txt\n' +
      '-rw-r--r-- 1 apprentice apprentice    0 Nov 14 20:15 empty.txt\n' +
      '-rw-r--r-- 1 apprentice apprentice   41 Nov 14 20:15 letter.txt\n' +
      '-rw-r--r-- 1 apprentice apprentice    8 Jan  2  2025 old.txt\n' +
      '-rwxr-xr-x 1 apprentice apprentice   12 Nov 14 20:15 run.sh\n',
  },
  {
    cmd: 'ls -lh big.txt letter.txt',
    out:
      '-rw-r--r-- 1 apprentice apprentice 4.9K Nov 14 20:15 big.txt\n' +
      '-rw-r--r-- 1 apprentice apprentice   41 Nov 14 20:15 letter.txt\n',
  },
  {
    cmd: 'ls -ld notes',
    out: 'drwxr-xr-x 2 apprentice apprentice 4096 Nov 14 20:15 notes\n',
  },
  {
    cmd: 'ls -la notes',
    out:
      'total 16\n' +
      'drwxr-xr-x 2 apprentice apprentice 4096 Nov 14 20:15 .\n' +
      'drwxr-xr-x 4 apprentice apprentice 4096 Nov 14 20:15 ..\n' +
      '-rw-r--r-- 1 apprentice apprentice    4 Nov 14 20:15 page1\n' +
      '-rw-r--r-- 1 apprentice apprentice    4 Nov 14 20:15 page2\n',
  },
  {
    cmd: 'ls -l',
    out:
      'total 44\n' +
      '-rw-r--r-- 1 apprentice apprentice 5000 Nov 14 20:15 big.txt\n' +
      '-rw-r--r-- 1 apprentice apprentice    7 Nov 14 20:15 blanks.txt\n' +
      '-rw-r--r-- 1 apprentice apprentice    0 Nov 14 20:15 empty.txt\n' +
      '-rw-r--r-- 1 apprentice apprentice  126 Nov 14 20:15 journal.txt\n' +
      '-rw-r--r-- 1 apprentice apprentice   41 Nov 14 20:15 letter.txt\n' +
      'drwxr-xr-x 2 apprentice apprentice 4096 Nov 14 20:15 many\n' +
      '-rw-r--r-- 1 apprentice apprentice   15 Nov 14 20:15 no-newline.txt\n' +
      'drwxr-xr-x 2 apprentice apprentice 4096 Nov 14 20:15 notes\n' +
      '-rw-r--r-- 1 apprentice apprentice    8 Jan  2  2025 old.txt\n' +
      '-rwxr-xr-x 1 apprentice apprentice   12 Nov 14 20:15 run.sh\n' +
      '-rw-r--r-- 1 apprentice apprentice    7 Nov 14 20:15 two words.txt\n',
  },
  {
    cmd: 'ls -lh',
    out:
      'total 44K\n' +
      '-rw-r--r-- 1 apprentice apprentice 4.9K Nov 14 20:15 big.txt\n' +
      '-rw-r--r-- 1 apprentice apprentice    7 Nov 14 20:15 blanks.txt\n' +
      '-rw-r--r-- 1 apprentice apprentice    0 Nov 14 20:15 empty.txt\n' +
      '-rw-r--r-- 1 apprentice apprentice  126 Nov 14 20:15 journal.txt\n' +
      '-rw-r--r-- 1 apprentice apprentice   41 Nov 14 20:15 letter.txt\n' +
      'drwxr-xr-x 2 apprentice apprentice 4.0K Nov 14 20:15 many\n' +
      '-rw-r--r-- 1 apprentice apprentice   15 Nov 14 20:15 no-newline.txt\n' +
      'drwxr-xr-x 2 apprentice apprentice 4.0K Nov 14 20:15 notes\n' +
      '-rw-r--r-- 1 apprentice apprentice    8 Jan  2  2025 old.txt\n' +
      '-rwxr-xr-x 1 apprentice apprentice   12 Nov 14 20:15 run.sh\n' +
      '-rw-r--r-- 1 apprentice apprentice    7 Nov 14 20:15 two words.txt\n',
  },
  {
    cmd: 'ls -l /',
    out:
      'total 16\n' +
      'drwxr-xr-x 2 root  root  4096 Nov 14 20:15 atrium\n' +
      'drwxr-xr-x 2 root  root  4096 Nov 14 20:15 etc\n' +
      'drwxr-xr-x 3 root  root  4096 Nov 14 20:15 home\n' +
      'drwx------ 2 lionx lionx 4096 Nov 14 20:15 vault\n',
    game: true,
  },
  {
    cmd: 'ls -l1 notes',
    out:
      'total 8\n' +
      '-rw-r--r-- 1 apprentice apprentice 4 Nov 14 20:15 page1\n' +
      '-rw-r--r-- 1 apprentice apprentice 4 Nov 14 20:15 page2\n',
  },
  { cmd: 'ls -1l notes | head -n 1', out: 'total 8\n' },

  // less and man without a terminal pass text through
  { cmd: 'less letter.txt', out: 'Dear apprentice,\nthe stacks are failing.\n', game: true },
  { cmd: 'echo piped | less', out: 'piped\n', game: true },
  { cmd: 'less missing', err: 'missing: No such file or directory\n', status: 1, game: true },
  { cmd: 'less notes', err: 'notes is a directory\n', status: 1, game: true },
  {
    cmd: 'man',
    err: "What manual page do you want?\nFor example, try 'man man'.\n",
    status: 1,
    game: true,
  },
  { cmd: 'man lionX', err: 'No manual entry for lionX\n', status: 16, game: true },
  // mkdir
  { cmd: 'mkdir shelf && ls -d shelf', out: 'shelf\n' },
  { cmd: 'mkdir notes', err: "mkdir: cannot create directory 'notes': File exists\n", status: 1 },
  {
    cmd: 'mkdir a/b',
    err: "mkdir: cannot create directory 'a/b': No such file or directory\n",
    status: 1,
  },
  { cmd: 'mkdir -p a/b/c && ls a/b', out: 'c\n' },
  { cmd: 'mkdir -p notes && echo ok', out: 'ok\n' },
  { cmd: 'mkdir -v x y', out: "mkdir: created directory 'x'\nmkdir: created directory 'y'\n" },
  {
    cmd: 'mkdir -pv a/b',
    out: "mkdir: created directory 'a'\nmkdir: created directory 'a/b'\n",
    game: true,
  },
  {
    cmd: 'mkdir',
    err: "mkdir: missing operand\nTry 'mkdir --help' for more information.\n",
    status: 1,
  },
  {
    cmd: 'mkdir letter.txt/x',
    err: "mkdir: cannot create directory 'letter.txt/x': Not a directory\n",
    status: 1,
  },
  {
    cmd: 'mkdir /vault/x',
    err: "mkdir: cannot create directory '/vault/x': Permission denied\n",
    status: 1,
    game: true,
  },

  // touch
  { cmd: 'touch fresh && ls fresh', out: 'fresh\n' },
  { cmd: 'touch a b && ls a b', out: 'a\nb\n' },
  {
    cmd: 'touch nope/x',
    err: "touch: cannot touch 'nope/x': No such file or directory\n",
    status: 1,
  },
  {
    cmd: 'touch -c ghost; ls ghost',
    err: "ls: cannot access 'ghost': No such file or directory\n",
    status: 2,
  },
  {
    cmd: 'touch',
    err: "touch: missing file operand\nTry 'touch --help' for more information.\n",
    status: 1,
  },

  // rmdir
  {
    cmd: 'mkdir e && rmdir e && ls -d e',
    err: "ls: cannot access 'e': No such file or directory\n",
    status: 2,
  },
  { cmd: 'rmdir notes', err: "rmdir: failed to remove 'notes': Directory not empty\n", status: 1 },
  {
    cmd: 'rmdir ghost',
    err: "rmdir: failed to remove 'ghost': No such file or directory\n",
    status: 1,
  },
  {
    cmd: 'rmdir letter.txt',
    err: "rmdir: failed to remove 'letter.txt': Not a directory\n",
    status: 1,
  },
  {
    cmd: 'mkdir -p a/b/c && rmdir -p a/b/c && ls -d a',
    err: "ls: cannot access 'a': No such file or directory\n",
    status: 2,
  },
  {
    cmd: 'rmdir',
    err: "rmdir: missing operand\nTry 'rmdir --help' for more information.\n",
    status: 1,
  },

  // rm
  {
    cmd: 'rm letter.txt && ls letter.txt',
    err: "ls: cannot access 'letter.txt': No such file or directory\n",
    status: 2,
  },
  { cmd: 'rm ghost', err: "rm: cannot remove 'ghost': No such file or directory\n", status: 1 },
  { cmd: 'rm -f ghost', status: 0 },
  { cmd: 'rm -f', status: 0 },
  { cmd: 'rm', err: "rm: missing operand\nTry 'rm --help' for more information.\n", status: 1 },
  { cmd: 'rm notes', err: "rm: cannot remove 'notes': Is a directory\n", status: 1 },
  {
    cmd: 'rm -r notes && ls -d notes',
    err: "ls: cannot access 'notes': No such file or directory\n",
    status: 2,
  },
  { cmd: 'rm -rf notes ghost && echo gone', out: 'gone\n' },
  { cmd: 'mkdir e && rm -d e && echo ok', out: 'ok\n' },
  { cmd: 'rm -v letter.txt empty.txt', out: "removed 'letter.txt'\nremoved 'empty.txt'\n" },
  {
    cmd: 'rm -rv notes',
    out: "removed 'notes/page1'\nremoved 'notes/page2'\nremoved directory 'notes'\n",
    game: true,
  },
  { cmd: 'rm .', err: "rm: cannot remove '.': Is a directory\n", status: 1 },
  {
    cmd: 'rm -r ..',
    err: "rm: refusing to remove '.' or '..' directory: skipping '..'\n",
    status: 1,
  },
  { cmd: 'rm *.txt && ls', out: 'many\nnotes\nrun.sh\n', game: true },
  {
    cmd: 'rm /vault/seal',
    err: "rm: cannot remove '/vault/seal': Permission denied\n",
    status: 1,
    game: true,
  },

  // cp
  {
    cmd: 'cp letter.txt copy.txt && cat copy.txt',
    out: 'Dear apprentice,\nthe stacks are failing.\n',
  },
  { cmd: 'cp letter.txt notes && ls notes', out: 'letter.txt\npage1\npage2\n' },
  { cmd: 'cp letter.txt notes/ && ls notes', out: 'letter.txt\npage1\npage2\n' },
  {
    cmd: 'cp letter.txt empty.txt notes && ls notes',
    out: 'empty.txt\nletter.txt\npage1\npage2\n',
  },
  { cmd: 'cp notes copy', err: "cp: -r not specified; omitting directory 'notes'\n", status: 1 },
  { cmd: 'cp -r notes copy && ls copy', out: 'page1\npage2\n' },
  {
    cmd: 'mkdir dest && cp -r notes dest && ls dest dest/notes',
    out: 'dest:\nnotes\n\ndest/notes:\npage1\npage2\n',
  },
  {
    cmd: 'cp letter.txt nowhere/',
    err: "cp: cannot create regular file 'nowhere/': Not a directory\n",
    status: 1,
  },
  {
    cmd: 'mv letter.txt nowhere/; ls letter.txt',
    out: 'letter.txt\n',
    err: "mv: cannot move 'letter.txt' to 'nowhere/': Not a directory\n",
    status: 0,
  },
  { cmd: 'mv notes moved/ && ls moved', out: 'page1\npage2\n' },
  { cmd: 'cp ghost x', err: "cp: cannot stat 'ghost': No such file or directory\n", status: 1 },
  {
    cmd: 'cp letter.txt letter.txt',
    err: "cp: 'letter.txt' and 'letter.txt' are the same file\n",
    status: 1,
  },
  {
    cmd: 'cp letter.txt empty.txt journal.txt',
    err: "cp: target 'journal.txt': Not a directory\n",
    status: 1,
  },
  {
    cmd: 'cp letter.txt',
    err: "cp: missing destination file operand after 'letter.txt'\nTry 'cp --help' for more information.\n",
    status: 1,
  },
  {
    cmd: 'cp',
    err: "cp: missing file operand\nTry 'cp --help' for more information.\n",
    status: 1,
  },
  {
    cmd: 'cp -r notes notes/inner',
    err: "cp: cannot copy a directory, 'notes', into itself, 'notes/inner'\n",
    status: 1,
  },
  { cmd: 'cp -v letter.txt c.txt', out: "'letter.txt' -> 'c.txt'\n" },
  {
    cmd: 'cp -n letter.txt journal.txt; head -n 1 journal.txt',
    out: 'entry 1\n',
    err: 'cp: warning: behavior of -n is non-portable and may change in future; use --update=none instead\n',
  },
  { cmd: 'cp *.txt notes && ls notes | head -n 3', out: 'big.txt\nblanks.txt\nempty.txt\n' },

  // mv
  {
    cmd: 'mv letter.txt moved.txt && ls moved.txt letter.txt',
    out: 'moved.txt\n',
    err: "ls: cannot access 'letter.txt': No such file or directory\n",
    status: 2,
  },
  { cmd: 'mv letter.txt notes && ls notes', out: 'letter.txt\npage1\npage2\n' },
  {
    cmd: 'mv letter.txt empty.txt notes && ls notes',
    out: 'empty.txt\nletter.txt\npage1\npage2\n',
  },
  { cmd: 'mv notes pages && ls pages', out: 'page1\npage2\n' },
  { cmd: 'mv ghost x', err: "mv: cannot stat 'ghost': No such file or directory\n", status: 1 },
  {
    cmd: 'mv notes notes/inner',
    err: "mv: cannot move 'notes' to a subdirectory of itself, 'notes/inner'\n",
    status: 1,
  },
  {
    cmd: 'mv letter.txt empty.txt journal.txt',
    err: "mv: target 'journal.txt': Not a directory\n",
    status: 1,
  },
  {
    cmd: 'mv letter.txt',
    err: "mv: missing destination file operand after 'letter.txt'\nTry 'mv --help' for more information.\n",
    status: 1,
  },
  { cmd: 'mv -v letter.txt l.txt', out: "renamed 'letter.txt' -> 'l.txt'\n" },
  {
    cmd: 'mv -n letter.txt journal.txt; head -n 1 journal.txt',
    out: 'entry 1\n',
    err: "mv: not replacing 'journal.txt'\n",
  },
  {
    cmd: 'mv letter.txt journal.txt && cat journal.txt',
    out: 'Dear apprentice,\nthe stacks are failing.\n',
  },
  { cmd: 'mkdir d && mv notes d && ls d', out: 'notes\n' },
  {
    cmd: 'mv notes /vault/x',
    err: "mv: cannot move 'notes' to '/vault/x': Permission denied\n",
    status: 1,
    game: true,
  },
  // grep
  { cmd: 'grep stacks letter.txt', out: 'the stacks are failing.\n' },
  {
    cmd: 'grep "entry 1" journal.txt',
    out: 'entry 1\nentry 10\nentry 11\nentry 12\nentry 13\nentry 14\nentry 15\n',
  },
  { cmd: 'grep -c "entry 1" journal.txt', out: '7\n' },
  { cmd: 'grep -n failing letter.txt', out: '2:the stacks are failing.\n' },
  { cmd: 'grep -i DEAR letter.txt', out: 'Dear apprentice,\n' },
  { cmd: 'grep -v entry journal.txt', out: '', status: 1 },
  { cmd: 'grep -v Dear letter.txt', out: 'the stacks are failing.\n' },
  { cmd: 'grep -x "entry 1" journal.txt', out: 'entry 1\n' },
  { cmd: 'grep -w "entry 1" journal.txt', out: 'entry 1\n' },
  { cmd: 'grep -o "st[a-z]*" letter.txt', out: 'stacks\n' },
  { cmd: 'grep -E "entry (2|3)$" journal.txt', out: 'entry 2\nentry 3\n' },
  { cmd: 'grep "entry 2$\\|entry 3$" journal.txt', out: 'entry 2\nentry 3\n' },
  { cmd: 'grep "(" letter.txt', out: '', status: 1 },
  { cmd: 'grep -F "." letter.txt', out: 'the stacks are failing.\n' },
  { cmd: 'grep -e -n letter.txt', out: '', status: 1 },
  { cmd: 'grep one notes/page1 notes/page2', out: 'notes/page1:one\n' },
  { cmd: 'grep -h one notes/page1 notes/page2', out: 'one\n' },
  { cmd: 'grep -l o notes/page1 notes/page2', out: 'notes/page1\nnotes/page2\n' },
  { cmd: 'grep -c o notes/page1 notes/page2', out: 'notes/page1:1\nnotes/page2:1\n' },
  { cmd: 'grep -r two notes', out: 'notes/page2:two\n' },
  { cmd: 'grep -rl o notes | sort', out: 'notes/page1\nnotes/page2\n' },
  { cmd: 'grep -q stacks letter.txt && echo found', out: 'found\n' },
  { cmd: 'grep nothing letter.txt', out: '', status: 1 },
  { cmd: 'grep x missing', err: 'grep: missing: No such file or directory\n', status: 2 },
  { cmd: 'grep x notes', err: 'grep: notes: Is a directory\n', status: 2 },
  { cmd: 'grep -s x missing', err: '', status: 2 },
  { cmd: 'cat letter.txt | grep Dear', out: 'Dear apprentice,\n' },
  {
    cmd: 'grep',
    err: "Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n",
    status: 2,
  },

  // find
  { cmd: 'find notes', out: 'notes\nnotes/page1\nnotes/page2\n' },
  { cmd: 'find notes/', out: 'notes/\nnotes/page1\nnotes/page2\n' },
  {
    cmd: 'find . -name "*.txt" | sort',
    out: './big.txt\n./blanks.txt\n./empty.txt\n./journal.txt\n./letter.txt\n./no-newline.txt\n./old.txt\n./two words.txt\n',
  },
  { cmd: 'find . -type d | sort', out: '.\n./many\n./notes\n' },
  { cmd: 'find notes -name page1', out: 'notes/page1\n' },
  { cmd: 'find . -maxdepth 1 -type d | sort', out: '.\n./many\n./notes\n' },
  { cmd: 'find . -mindepth 2 -name "page*" | sort', out: './notes/page1\n./notes/page2\n' },
  { cmd: 'find . -iname "LETTER*"', out: './letter.txt\n' },
  { cmd: 'find . -empty -type f | sort | head -n 3', out: './empty.txt\n./many/a\n./many/bb\n' },
  {
    cmd: 'find . -maxdepth 1 ! -type d -name "*e*" | sort',
    out: './.sealed-tome\n./empty.txt\n./letter.txt\n./no-newline.txt\n',
  },
  { cmd: 'find . -name ".*" -type f', out: './.sealed-tome\n' },
  { cmd: 'find missing', err: "find: 'missing': No such file or directory\n", status: 1 },
  { cmd: 'find . -foo', err: "find: unknown predicate `-foo'\n", status: 1 },
  { cmd: 'find . -name', err: "find: missing argument to `-name'\n", status: 1 },
  {
    cmd: 'find /vault',
    out: '/vault\n',
    err: "find: '/vault': Permission denied\n",
    status: 1,
    game: true,
  },

  // wc
  { cmd: 'wc -l journal.txt', out: '15 journal.txt\n' },
  { cmd: 'wc journal.txt', out: ' 15  30 126 journal.txt\n' },
  {
    cmd: 'wc letter.txt journal.txt',
    out: '  2   6  41 letter.txt\n 15  30 126 journal.txt\n 17  36 167 total\n',
  },
  { cmd: 'wc -w letter.txt', out: '6 letter.txt\n' },
  { cmd: 'wc -c big.txt', out: '5000 big.txt\n' },
  { cmd: 'cat journal.txt | wc -l', out: '15\n' },
  { cmd: 'echo hi there | wc', out: '      1       2       9\n' },
  { cmd: 'wc -l < letter.txt', out: '2\n' },
  { cmd: 'wc -lw letter.txt', out: ' 2  6 letter.txt\n' },
  { cmd: 'wc no-newline.txt', out: ' 1  3 15 no-newline.txt\n' },
  { cmd: 'wc missing', err: 'wc: missing: No such file or directory\n', status: 1 },

  // sort
  { cmd: 'echo -e "pear\\napple\\nfig" | sort', out: 'apple\nfig\npear\n' },
  { cmd: 'echo -e "pear\\napple\\nfig" | sort -r', out: 'pear\nfig\napple\n' },
  { cmd: 'echo -e "10\\n9\\n100" | sort', out: '10\n100\n9\n' },
  { cmd: 'echo -e "10\\n9\\n100" | sort -n', out: '9\n10\n100\n' },
  { cmd: 'echo -e "10\\n9\\n100" | sort -rn', out: '100\n10\n9\n' },
  { cmd: 'echo -e "b\\na\\nb\\na" | sort -u', out: 'a\nb\n' },
  { cmd: 'echo -e "b\\nB\\na" | sort', out: 'B\na\nb\n' },
  { cmd: 'echo -e "b\\nB\\na" | sort -f', out: 'a\nB\nb\n' },
  { cmd: 'sort notes/page2 notes/page1', out: 'one\ntwo\n' },
  {
    cmd: 'sort missing',
    err: 'sort: cannot read: missing: No such file or directory\n',
    status: 2,
  },

  // uniq
  { cmd: 'echo -e "a\\na\\nb\\na" | uniq', out: 'a\nb\na\n' },
  { cmd: 'echo -e "a\\na\\nb\\na" | uniq -c', out: '      2 a\n      1 b\n      1 a\n' },
  { cmd: 'echo -e "a\\na\\nb\\na" | uniq -d', out: 'a\n' },
  { cmd: 'echo -e "a\\na\\nb\\na" | uniq -u', out: 'b\na\n' },
  { cmd: 'echo -e "a\\nb\\na\\nb\\nb" | sort | uniq -c', out: '      2 a\n      3 b\n' },
  { cmd: 'echo -e "a\\nb\\na" | sort | uniq -c | sort -rn', out: '      2 a\n      1 b\n' },
  { cmd: 'uniq missing', err: 'uniq: missing: No such file or directory\n', status: 1 },
  // Pipes and redirection, stress-tested with real commands
  { cmd: 'cat journal.txt | grep 1 | sort -r | head -n 3', out: 'entry 15\nentry 14\nentry 13\n' },
  { cmd: 'cat journal.txt | grep 1 | sort -r | head -n 3 | tail -n 1 | wc -c', out: '9\n' },
  { cmd: 'sort -r < journal.txt > rev.txt; head -n 2 rev.txt', out: 'entry 9\nentry 8\n' },
  { cmd: 'grep entry journal.txt | wc -l > count.txt; cat count.txt', out: '15\n' },
  { cmd: 'ls > listing.txt; grep -c txt listing.txt', out: '9\n' },
  {
    cmd: 'cat letter.txt >> journal.txt; tail -n 3 journal.txt',
    out: 'entry 15\nDear apprentice,\nthe stacks are failing.\n',
  },
  { cmd: 'cat notes/page1 > out.txt; cat notes/page2 >> out.txt; cat out.txt', out: 'one\ntwo\n' },
  {
    cmd: 'ls missing notes 2> err.txt; cat err.txt',
    out: "notes:\npage1\npage2\nls: cannot access 'missing': No such file or directory\n",
  },
  { cmd: 'ls missing 2>&1 | grep -c cannot', out: '1\n' },
  { cmd: 'ls missing 2>/dev/null; echo $?', out: '2\n' },
  { cmd: 'cat missing letter.txt 2>/dev/null | head -n 1', out: 'Dear apprentice,\n' },
  {
    cmd: 'grep -h o notes/* missing 2>/dev/null | sort | uniq -c',
    out: '      1 one\n      1 two\n',
  },
  { cmd: 'mkdir x && cd x && pwd', out: '/home/apprentice/x\n' },
  { cmd: 'cd missing && pwd', err: 'bash: cd: missing: No such file or directory\n', status: 1 },
  { cmd: 'grep zzz letter.txt && echo found || echo absent', out: 'absent\n' },
  { cmd: 'cat < letter.txt | wc -l', out: '2\n' },
  { cmd: 'wc -l < journal.txt > n.txt && cat n.txt', out: '15\n' },
  { cmd: 'false | true && echo ok', out: 'ok\n' },
  { cmd: 'sort journal.txt | uniq | wc -l', out: '15\n' },
  {
    cmd: 'head -n 3 journal.txt > a.txt; tail -n 3 journal.txt >> a.txt; cat a.txt | wc -l',
    out: '6\n',
  },
  { cmd: 'cat journal.txt notes/page1 | tail -n 2', out: 'entry 15\none\n' },
  { cmd: 'ls notes > notes/list; cat notes/list', out: 'list\npage1\npage2\n' },
  // whoami, id, chmod, chown, sudo
  { cmd: 'whoami', out: 'apprentice\n', game: true },
  {
    cmd: 'id',
    out: 'uid=1000(apprentice) gid=1000(apprentice) groups=1000(apprentice)\n',
    game: true,
  },
  { cmd: 'id -un', out: 'apprentice\n', game: true },
  {
    cmd: 'id archivist',
    out: 'uid=1001(archivist) gid=1001(archivist) groups=1001(archivist),1002(scribes)\n',
    game: true,
  },
  { cmd: 'id nobody2', err: "id: 'nobody2': no such user\n", status: 1, game: true },
  {
    cmd: 'chmod 600 letter.txt && ls -l letter.txt',
    out: '-rw------- 1 apprentice apprentice 41 Nov 14 20:15 letter.txt\n',
  },
  {
    cmd: 'chmod u+x letter.txt && ls -l letter.txt',
    out: '-rwxr--r-- 1 apprentice apprentice 41 Nov 14 20:15 letter.txt\n',
  },
  {
    cmd: 'chmod +x letter.txt && ls -l letter.txt',
    out: '-rwxr-xr-x 1 apprentice apprentice 41 Nov 14 20:15 letter.txt\n',
  },
  {
    cmd: 'chmod go-r letter.txt && ls -l letter.txt',
    out: '-rw------- 1 apprentice apprentice 41 Nov 14 20:15 letter.txt\n',
  },
  {
    cmd: 'chmod a=r letter.txt && ls -l letter.txt',
    out: '-r--r--r-- 1 apprentice apprentice 41 Nov 14 20:15 letter.txt\n',
  },
  {
    cmd: 'chmod u=rw,g=r,o= letter.txt && ls -l letter.txt',
    out: '-rw-r----- 1 apprentice apprentice 41 Nov 14 20:15 letter.txt\n',
  },
  {
    cmd: 'chmod -w letter.txt && ls -l letter.txt',
    out: '-r--r--r-- 1 apprentice apprentice 41 Nov 14 20:15 letter.txt\n',
  },
  {
    cmd: 'chmod +w letter.txt && ls -l letter.txt',
    out: '-rw-r--r-- 1 apprentice apprentice 41 Nov 14 20:15 letter.txt\n',
  },
  {
    cmd: 'chmod 750 notes && ls -ld notes',
    out: 'drwxr-x--- 2 apprentice apprentice 4096 Nov 14 20:15 notes\n',
  },
  {
    cmd: 'chmod -R go-rx notes && ls -l notes',
    out: 'total 8\n-rw------- 1 apprentice apprentice 4 Nov 14 20:15 page1\n-rw------- 1 apprentice apprentice 4 Nov 14 20:15 page2\n',
  },
  {
    cmd: 'chmod a+X notes/page1 && ls -l notes/page1',
    out: '-rw-r--r-- 1 apprentice apprentice 4 Nov 14 20:15 notes/page1\n',
  },
  { cmd: 'chmod 644 letter.txt; chmod -c 644 letter.txt', out: '' },
  {
    cmd: 'chmod -v 640 letter.txt',
    out: "mode of 'letter.txt' changed from 0644 (rw-r--r--) to 0640 (rw-r-----)\n",
  },
  {
    cmd: 'chmod 640 letter.txt; chmod -v 640 letter.txt',
    out: "mode of 'letter.txt' retained as 0640 (rw-r-----)\n",
  },
  {
    cmd: 'chmod -c 700 notes',
    out: "mode of 'notes' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\n",
  },
  {
    cmd: 'chmod q+z letter.txt',
    err: "chmod: invalid mode: 'q+z'\nTry 'chmod --help' for more information.\n",
    status: 1,
  },
  {
    cmd: 'chmod 644',
    err: "chmod: missing operand after '644'\nTry 'chmod --help' for more information.\n",
    status: 1,
  },
  {
    cmd: 'chmod',
    err: "chmod: missing operand\nTry 'chmod --help' for more information.\n",
    status: 1,
  },
  {
    cmd: 'chmod 644 ghost',
    err: "chmod: cannot access 'ghost': No such file or directory\n",
    status: 1,
  },
  {
    cmd: 'chmod 777 /vault',
    err: "chmod: changing permissions of '/vault': Operation not permitted\n",
    status: 1,
    game: true,
  },
  {
    cmd: 'chown archivist letter.txt',
    err: "chown: changing ownership of 'letter.txt': Operation not permitted\n",
    status: 1,
    game: true,
  },
  {
    cmd: 'chown nobody2 letter.txt',
    err: "chown: invalid user: 'nobody2'\n",
    status: 1,
    game: true,
  },
  {
    cmd: 'chown :nogroup2 letter.txt',
    err: "chown: invalid group: ':nogroup2'\n",
    status: 1,
    game: true,
  },
  {
    cmd: 'chown',
    err: "chown: missing operand\nTry 'chown --help' for more information.\n",
    status: 1,
  },
  {
    cmd: 'sudo whoami',
    err: 'sudo: a terminal is required to read the password; either use the -S option to read from standard input or configure an askpass helper\nsudo: a password is required\n',
    status: 1,
    game: true,
  },
  {
    cmd: 'echo wrong | sudo -S whoami',
    err: '[sudo] password for apprentice: \nSorry, try again.\nsudo: no password was provided\nsudo: 1 incorrect password attempt\n',
    status: 1,
    game: true,
  },
  {
    cmd: 'echo oriel | sudo -S whoami',
    out: 'root\n',
    err: '[sudo] password for apprentice: \n',
    game: true,
  },
  {
    cmd: 'echo oriel | sudo -S chown archivist:scribes letter.txt && ls -l letter.txt',
    out: '-rw-r--r-- 1 archivist scribes 41 Nov 14 20:15 letter.txt\n',
    err: '[sudo] password for apprentice: \n',
    game: true,
  },
  {
    cmd: 'echo oriel | sudo -S cat /vault/seal',
    out: 'lionX was here\n',
    err: '[sudo] password for apprentice: \n',
    game: true,
  },
  {
    cmd: 'echo oriel | sudo -S -u archivist whoami',
    out: 'archivist\n',
    err: '[sudo] password for apprentice: \n',
    game: true,
  },
  {
    cmd: 'echo oriel | sudo -S lionX',
    err: '[sudo] password for apprentice: \nsudo: lionX: command not found\n',
    status: 1,
    game: true,
  },
];
