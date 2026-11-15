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
      'total 12\n' +
      'drwxr-xr-x 2 root  root  4096 Nov 14 20:15 atrium\n' +
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
];
