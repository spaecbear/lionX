import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { createRegistry } from '../engine/commands';
import { Shell } from '../engine/shell';
import { buildWorld, type WorldSpec } from '../engine/vfs';
import devWorld from '../content/dev/world.json';
import { TerminalController } from './terminal/controller';
import { candlelit, FONT_STACK } from './theme';

/** The whole game: one terminal filling the viewport. */
export function Terminal() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current!;
    const term = new XTerm({
      theme: candlelit,
      fontFamily: FONT_STACK,
      fontSize: 16,
      lineHeight: 1.15,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 2000,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const vfs = buildWorld(devWorld.world as WorldSpec);
    const shell = new Shell({
      vfs,
      registry: createRegistry(),
      terminal: { stdout: { write() {} }, stderr: { write() {} } },
      env: { USER: vfs.credentials.user, PWD: vfs.cwd },
    });
    const controller = new TerminalController(term, shell, { motd: devWorld.motd });
    controller.start();
    const sub = term.onData((d) => void controller.handleData(d));
    term.focus();

    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(el);

    return () => {
      ro.disconnect();
      sub.dispose();
      term.dispose();
    };
  }, []);

  return <div ref={host} className="terminal-host" aria-label="Archive terminal" />;
}
