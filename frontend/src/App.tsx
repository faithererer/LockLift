import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  AppWindow,
  CheckCircle2,
  ExternalLink,
  FileSearch2,
  HardDriveDownload,
  History,
  LoaderCircle,
  RefreshCcw,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  ClearRecentFiles,
  GetRecentFiles,
  InspectFile,
  IsElevated,
  OpenInExplorer,
  PickDirectory,
  PickFile,
  ReleaseLocks,
  RelaunchElevated,
} from '../wailsjs/go/main/App';
import { OnFileDrop, OnFileDropOff, WindowSetDarkTheme } from '../wailsjs/runtime/runtime';

type LockingProcess = {
  pid: number;
  name: string;
  appType: string;
  exePath: string;
  canKill: boolean;
  blockReason: string;
};

type InspectSummary = {
  total: number;
  killableCount: number;
  blockedCount: number;
};

type InspectResult = {
  path: string;
  targetKind: string;
  exists: boolean;
  isFile: boolean;
  isElevated: boolean;
  hasLocks: boolean;
  needsElevationHint: boolean;
  scannedFileCount: number;
  truncated: boolean;
  processes: LockingProcess[];
  summary: InspectSummary;
  message: string;
  warning?: string;
  error?: string;
};

type ReleaseResult = {
  path: string;
  requestedPids: number[];
  releasedCount: number;
  failedCount: number;
  inspect: InspectResult;
  message: string;
  error?: string;
};

type NoticeTone = 'success' | 'error' | 'info';

type Notice = {
  id: number;
  tone: NoticeTone;
  title: string;
  body: string;
};

const noticeStyles: Record<NoticeTone, string> = {
  success: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-50',
  error: 'border-rose-400/25 bg-rose-400/10 text-rose-50',
  info: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-50',
};

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm font-semibold transition duration-200 disabled:cursor-not-allowed disabled:opacity-40 sm:px-4 sm:py-3';

function App() {
  const [pathInput, setPathInput] = useState('');
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(null);
  const [recentTargets, setRecentTargets] = useState<string[]>([]);
  const [selectedPids, setSelectedPids] = useState<number[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [isElevated, setIsElevated] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);

  const inputPanelRef = useRef<HTMLDivElement | null>(null);

  const selectedProcesses = inspectResult
    ? inspectResult.processes.filter((item) => selectedPids.includes(item.pid))
    : [];

  useEffect(() => {
    WindowSetDarkTheme();

    void Promise.all([GetRecentFiles(), IsElevated()]).then(([recent, elevated]) => {
      setRecentTargets(recent);
      setIsElevated(elevated);
    });

    OnFileDrop((_x, _y, paths) => {
      setDropActive(false);
      if (!paths || paths.length === 0) {
        return;
      }
      if (paths.length > 1) {
        pushNotice('info', '已接收拖拽内容', '检测时仅会使用第一个路径');
      }
      void inspectTarget(paths[0]);
    }, false);

    let dragDepth = 0;
    const onDragEnter = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        dragDepth += 1;
        setDropActive(true);
      }
    };
    const onDragLeave = () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        setDropActive(false);
      }
    };
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
      }
    };
    const onDrop = () => {
      dragDepth = 0;
      setDropActive(false);
    };
    const onWindowMouseDown = (event: MouseEvent) => {
      if (
        inputPanelRef.current &&
        event.target instanceof Node &&
        !inputPanelRef.current.contains(event.target)
      ) {
        setRecentOpen(false);
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('mousedown', onWindowMouseDown);

    return () => {
      OnFileDropOff();
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('mousedown', onWindowMouseDown);
    };
  }, []);

  function pushNotice(tone: NoticeTone, title: string, body: string) {
    const id = Date.now() + Math.random();
    setNotices((current) => [{ id, tone, title, body }, ...current].slice(0, 4));
    window.setTimeout(() => {
      setNotices((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }

  function explainError(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return '操作失败，请稍后重试';
  }

  async function refreshRecentTargets() {
    const recent = await GetRecentFiles();
    setRecentTargets(recent);
    if (recent.length === 0) {
      setRecentOpen(false);
    }
  }

  async function inspectTarget(rawPath: string) {
    const candidate = rawPath.trim();
    if (!candidate) {
      pushNotice('error', '路径为空', '请输入或选择一个文件 / 文件夹路径');
      return;
    }

    setIsInspecting(true);
    setSelectedPids([]);
    setRecentOpen(false);
    setPathInput(candidate);

    try {
      const result = (await InspectFile(candidate)) as InspectResult;
      setInspectResult(result);
      setPathInput(result.path || candidate);
      setIsElevated(result.isElevated);
      await refreshRecentTargets();

      if (result.error) {
        pushNotice('error', '扫描失败', result.message || result.error);
      } else if (result.warning) {
        pushNotice('info', '扫描完成', result.warning);
      }
    } catch (error) {
      pushNotice('error', '扫描失败', explainError(error));
    } finally {
      setIsInspecting(false);
    }
  }

  async function handlePickFile() {
    try {
      const selection = await PickFile();
      if (selection) {
        await inspectTarget(selection);
      }
    } catch (error) {
      pushNotice('error', '选择文件失败', explainError(error));
    }
  }

  async function handlePickDirectory() {
    try {
      const selection = await PickDirectory();
      if (selection) {
        await inspectTarget(selection);
      }
    } catch (error) {
      pushNotice('error', '选择文件夹失败', explainError(error));
    }
  }

  async function handleReleaseConfirmed() {
    if (!pathInput.trim() || selectedPids.length === 0) {
      return;
    }

    setConfirmOpen(false);
    setIsReleasing(true);

    try {
      const result = (await ReleaseLocks(pathInput.trim(), selectedPids)) as ReleaseResult;
      setInspectResult(result.inspect);
      setSelectedPids([]);
      setIsElevated(result.inspect.isElevated);
      await refreshRecentTargets();

      pushNotice(
        result.failedCount > 0 ? 'info' : 'success',
        result.failedCount > 0 ? '释放部分完成' : '释放完成',
        result.message,
      );
    } catch (error) {
      pushNotice('error', '释放失败', explainError(error));
    } finally {
      setIsReleasing(false);
    }
  }

  async function handleRestartAsAdmin() {
    try {
      await RelaunchElevated();
    } catch (error) {
      pushNotice('error', '提权失败', explainError(error));
    }
  }

  async function handleOpenInExplorer(target: string) {
    try {
      await OpenInExplorer(target);
    } catch (error) {
      pushNotice('error', '打开失败', explainError(error));
    }
  }

  async function handleClearRecent() {
    try {
      await ClearRecentFiles();
      setRecentTargets([]);
      setRecentOpen(false);
      pushNotice('success', '已清空最近记录', '最近检测的路径列表已经清空');
    } catch (error) {
      pushNotice('error', '清空失败', explainError(error));
    }
  }

  function togglePid(pid: number) {
    setSelectedPids((current) =>
      current.includes(pid) ? current.filter((item) => item !== pid) : [...current, pid],
    );
  }

  const targetLabel = inspectResult?.targetKind === 'directory' ? '文件夹' : '文件';
  const canRelease = selectedProcesses.length > 0 && !isReleasing;
  const statusMessage = inspectResult?.message || '扫描后会在这里展示占用进程和状态提示';
  const summaryBadges = [
    {
      label: '占用',
      value: inspectResult?.summary.total ?? 0,
      className: 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100',
    },
    {
      label: '可释放',
      value: inspectResult?.summary.killableCount ?? 0,
      className: 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100',
    },
    {
      label: '已保护',
      value: inspectResult?.summary.blockedCount ?? 0,
      className: 'border-amber-300/20 bg-amber-400/10 text-amber-100',
    },
    {
      label: '已扫描文件',
      value: inspectResult?.scannedFileCount ?? 0,
      className: 'border-fuchsia-300/20 bg-fuchsia-400/10 text-fuchsia-100',
    },
  ];

  return (
    <div className="relative h-full overflow-x-hidden overflow-y-auto text-slate-100">
      {dropActive ? (
        <motion.div
          className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            className="glass-panel mx-4 rounded-[2rem] border-cyan-300/20 px-6 py-8 text-center sm:px-10 sm:py-10"
          >
            <HardDriveDownload className="mx-auto mb-4 h-14 w-14 text-cyan-300" />
            <div className="text-xl font-semibold text-white sm:text-2xl">将文件或文件夹拖到这里</div>
            <p className="mt-2 text-sm text-slate-300">LockLift 会自动开始扫描占用进程</p>
          </motion.div>
        </motion.div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-end p-3 sm:p-5">
        <div className="flex w-full max-w-md flex-col gap-2.5 sm:gap-3">
          {notices.map((notice) => (
            <motion.div
              key={notice.id}
              initial={{ opacity: 0, x: 18, y: -8 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              className={clsx(
                'glass-panel pointer-events-auto rounded-3xl border px-4 py-3',
                noticeStyles[notice.tone],
              )}
            >
              <div className="text-sm font-semibold">{notice.title}</div>
              <div className="mt-1 text-sm text-slate-200/90">{notice.body}</div>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="mx-auto flex min-h-full w-full max-w-[1880px] flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-4 sm:py-4 md:px-5">
        <motion.header
          initial={{ opacity: 0, y: -18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 180, damping: 20 }}
          className="glass-panel rounded-[1.6rem] px-4 py-3 sm:rounded-[1.8rem] sm:px-5 sm:py-4"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="label-chip border-cyan-300/20 bg-cyan-400/10 text-cyan-100">
                  <Sparkles className="h-3.5 w-3.5" />
                  Windows 文件 / 文件夹占用释放器
                </div>
              </div>
              <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-4 sm:gap-y-2">
                <h1 className="text-[1.55rem] font-semibold tracking-tight text-white sm:text-[1.9rem]">LockLift</h1>
                <p className="text-xs text-slate-400 sm:text-sm">查看占用进程并按需释放，不做默认全杀。</p>
              </div>
            </div>

            <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
              <span className="label-chip bg-white/[0.04] text-slate-300">
                <AppWindow className="h-3.5 w-3.5 text-cyan-300" />
                WebView2 + Wails
              </span>
              <span
                className={clsx(
                  'label-chip',
                  isElevated
                    ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100'
                    : 'border-amber-300/20 bg-amber-400/10 text-amber-100',
                )}
              >
                {isElevated ? (
                  <ShieldCheck className="h-3.5 w-3.5" />
                ) : (
                  <ShieldAlert className="h-3.5 w-3.5" />
                )}
                {isElevated ? '管理员模式' : '普通模式'}
              </span>
            </div>
          </div>
        </motion.header>

        {!isElevated ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel flex flex-col gap-3 rounded-[1.35rem] border-amber-300/20 bg-amber-400/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:rounded-[1.45rem]"
          >
            <div className="min-w-0">
              <div className="text-sm font-semibold text-amber-50">当前不是管理员模式</div>
              <div className="mt-1 text-xs text-amber-100/90">
                某些系统服务或高权限进程可能无法结束，需要时可以直接提权重启。
              </div>
            </div>
            <button
              onClick={handleRestartAsAdmin}
              className={clsx(
                buttonBase,
                'bg-amber-300/90 px-3 py-2 text-slate-950 hover:bg-amber-200',
              )}
            >
              <ShieldCheck className="h-4 w-4" />
              以管理员身份重启
            </button>
          </motion.div>
        ) : null}

        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, type: 'spring', stiffness: 160, damping: 22 }}
          className="glass-panel flex min-h-0 flex-1 flex-col rounded-[1.6rem] p-3 sm:rounded-[1.9rem] sm:p-4"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-slate-500">目标路径</div>
              <h2 className="mt-1 text-lg font-semibold text-white">扫描文件或文件夹</h2>
            </div>
            <div className="text-xs text-slate-500">支持拖拽、本地路径、最近记录下拉</div>
          </div>

          <div ref={inputPanelRef} className="relative mt-3">
            <div className="flex flex-col gap-2.5 2xl:flex-row">
              <div className="relative flex-1">
                <FileSearch2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={pathInput}
                  onChange={(event) => setPathInput(event.target.value)}
                  onFocus={() => {
                    if (recentTargets.length > 0) {
                      setRecentOpen(true);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void inspectTarget(pathInput);
                    }
                  }}
                  placeholder="输入或粘贴本地文件 / 文件夹路径"
                  className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/55 pl-11 pr-4 text-sm text-slate-100 outline-none transition focus:border-cyan-300/35 focus:ring-2 focus:ring-cyan-300/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap">
                <button
                  onClick={() => setRecentOpen((current) => !current)}
                  disabled={recentTargets.length === 0}
                  className={clsx(buttonBase, 'w-full bg-white/6 px-3 py-2.5 text-slate-200 hover:bg-white/10 sm:w-auto')}
                >
                  <History className="h-4 w-4" />
                  最近
                </button>
                <button
                  onClick={handlePickFile}
                  className={clsx(buttonBase, 'w-full bg-white/6 px-3 py-2.5 text-slate-200 hover:bg-white/10 sm:w-auto')}
                >
                  <FileSearch2 className="h-4 w-4" />
                  选文件
                </button>
                <button
                  onClick={handlePickDirectory}
                  className={clsx(buttonBase, 'w-full bg-white/6 px-3 py-2.5 text-slate-200 hover:bg-white/10 sm:w-auto')}
                >
                  <ScanSearch className="h-4 w-4" />
                  选文件夹
                </button>
                <button
                  onClick={() => void inspectTarget(pathInput)}
                  disabled={isInspecting}
                  className={clsx(
                    buttonBase,
                    'col-span-2 w-full bg-gradient-to-r from-cyan-400 to-teal-400 px-4 py-2.5 text-slate-950 shadow-lg shadow-cyan-500/20 hover:brightness-110 sm:col-span-1 sm:w-auto',
                  )}
                >
                  {isInspecting ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <ScanSearch className="h-4 w-4" />
                  )}
                  {isInspecting ? '扫描中...' : '开始扫描'}
                </button>
              </div>
            </div>

            <div className="mt-2 hidden flex-wrap items-center gap-2 text-xs text-slate-500 md:flex">
              <span>拖入路径后会自动扫描</span>
              <span className="h-1 w-1 rounded-full bg-slate-700" />
              <span>目录会递归汇总内部文件占用</span>
              <span className="h-1 w-1 rounded-full bg-slate-700" />
              <span>释放动作默认先选再杀</span>
            </div>

            {recentOpen && recentTargets.length > 0 ? (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute left-0 right-0 top-full z-20 mt-3 overflow-hidden rounded-[1.45rem] border border-white/10 bg-slate-950/95 shadow-[0_26px_80px_rgba(2,8,23,.6)] backdrop-blur-xl md:right-auto md:w-[720px]"
              >
                <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-white">最近路径</div>
                    <div className="mt-0.5 text-xs text-slate-500">点击后会立即重新扫描</div>
                  </div>
                  <button
                    onClick={() => void handleClearRecent()}
                    className={clsx(buttonBase, 'bg-white/6 px-3 py-2 text-slate-200 hover:bg-white/10')}
                  >
                    <Trash2 className="h-4 w-4" />
                    清空
                  </button>
                </div>

                <div className="max-h-[320px] overflow-auto p-3">
                  {recentTargets.map((target) => (
                    <button
                      key={target}
                      onClick={() => void inspectTarget(target)}
                      className="group w-full rounded-2xl border border-transparent bg-white/[0.03] px-4 py-3 text-left transition hover:border-cyan-300/20 hover:bg-cyan-400/8"
                    >
                      <div className="truncate text-sm font-medium text-slate-100" title={target}>
                        {target}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="label-chip border-white/10 bg-white/[0.03] px-2.5 py-1 text-slate-400">
                          立即扫描
                        </span>
                        <span className="opacity-0 transition group-hover:opacity-100">
                          也可以直接在输入框按回车开始扫描
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : null}
          </div>

          <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-[1.45rem] border border-white/10 bg-slate-950/35 sm:rounded-[1.65rem]">
            <div className="border-b border-white/8 px-3 py-3 sm:px-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-white">{targetLabel}扫描结果</h3>
                    {inspectResult?.targetKind ? (
                      <span className="label-chip bg-white/[0.03] text-slate-300">
                        {inspectResult.targetKind === 'directory' ? '文件夹模式' : '文件模式'}
                      </span>
                    ) : null}
                    {inspectResult?.truncated ? (
                      <span className="label-chip border-amber-300/20 bg-amber-400/10 text-amber-100">
                        目录已截断扫描
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-400">{statusMessage}</div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => pathInput && void handleOpenInExplorer(pathInput)}
                    disabled={!pathInput}
                    className={clsx(buttonBase, 'bg-white/6 px-3 py-2 text-slate-200 hover:bg-white/10')}
                  >
                    <ExternalLink className="h-4 w-4" />
                    打开位置
                  </button>
                  <button
                    onClick={() => void inspectTarget(pathInput)}
                    disabled={!pathInput || isInspecting}
                    className={clsx(buttonBase, 'bg-white/6 px-3 py-2 text-slate-200 hover:bg-white/10')}
                  >
                    <RefreshCcw className={clsx('h-4 w-4', isInspecting && 'animate-spin')} />
                    重扫
                  </button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {summaryBadges.map((badge) => (
                  <span key={badge.label} className={clsx('label-chip', badge.className)}>
                    <span className="text-slate-300/80">{badge.label}</span>
                    <span className="font-semibold text-current">{badge.value}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {inspectResult?.error ? (
                <div className="flex h-full min-h-[220px] items-center justify-center px-4 py-4 sm:min-h-[280px] sm:px-6 sm:py-6">
                  <div className="surface-panel flex w-full max-w-3xl flex-col items-center justify-center rounded-[1.2rem] border-rose-300/15 px-4 py-8 text-center sm:rounded-[1.4rem] sm:px-6 sm:py-10">
                    <AlertTriangle className="h-12 w-12 text-rose-300" />
                    <div className="mt-4 text-lg font-semibold text-white">当前路径无法检测</div>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                      {inspectResult.message}
                    </p>
                  </div>
                </div>
              ) : !inspectResult ? (
                <div className="flex h-full min-h-[220px] items-center justify-center px-4 py-4 sm:min-h-[280px] sm:px-6 sm:py-6">
                  <div className="surface-panel flex w-full max-w-3xl flex-col items-center justify-center rounded-[1.2rem] px-4 py-8 text-center sm:rounded-[1.4rem] sm:px-6 sm:py-10">
                    <ScanSearch className="h-12 w-12 text-cyan-300" />
                    <div className="mt-4 text-lg font-semibold text-white">等待一次扫描</div>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                      你可以输入路径、点击选择器，或者直接把文件 / 文件夹拖进窗口。
                    </p>
                  </div>
                </div>
              ) : !inspectResult.hasLocks ? (
                <div className="flex h-full min-h-[220px] items-center justify-center px-4 py-4 sm:min-h-[280px] sm:px-6 sm:py-6">
                  <div className="surface-panel flex w-full max-w-3xl flex-col items-center justify-center rounded-[1.2rem] px-4 py-8 text-center sm:rounded-[1.4rem] sm:px-6 sm:py-10">
                    <CheckCircle2 className="h-12 w-12 text-emerald-300" />
                    <div className="mt-4 text-lg font-semibold text-white">当前未发现占用</div>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                      {inspectResult.warning
                        ? `${inspectResult.message}；${inspectResult.warning}`
                        : inspectResult.message}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-0 flex-col">
                  {inspectResult.warning ? (
                    <div className="mx-3 mt-3 rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-50 sm:mx-4">
                      {inspectResult.warning}
                    </div>
                  ) : null}

                  <div className="min-h-0 flex-1 overflow-auto">
                    <div className="grid gap-3 p-3 lg:hidden">
                      {inspectResult.processes.map((process, index) => {
                        const checked = selectedPids.includes(process.pid);
                        return (
                          <motion.div
                            key={process.pid}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.02 }}
                            className={clsx(
                              'surface-panel rounded-[1.3rem] px-4 py-3 transition',
                              checked ? 'border-cyan-300/20 bg-cyan-400/8' : '',
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="text-sm font-semibold text-slate-100">{process.name}</div>
                                  <span className="text-xs text-slate-500">PID {process.pid}</span>
                                </div>
                                <div className="mt-1 text-xs text-slate-400">{process.appType}</div>
                              </div>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!process.canKill}
                                onChange={() => togglePid(process.pid)}
                                className="mt-0.5 h-4 w-4 rounded border-white/15 bg-slate-950/60 accent-cyan-400"
                              />
                            </div>

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {process.canKill ? (
                                <span className="label-chip border-emerald-300/20 bg-emerald-400/10 text-emerald-100">
                                  可释放
                                </span>
                              ) : (
                                <span className="label-chip border-amber-300/20 bg-amber-400/10 text-amber-100">
                                  已保护
                                </span>
                              )}
                            </div>

                            {!process.canKill && process.blockReason ? (
                              <div className="mt-2 text-xs text-amber-200">{process.blockReason}</div>
                            ) : null}

                            <div className="mt-3 rounded-2xl bg-white/[0.03] px-3 py-2 text-xs leading-5 text-slate-400 break-all">
                              {process.exePath || '未能读取程序路径'}
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>

                    <div className="hidden lg:block">
                      <table className="min-w-full border-collapse text-left text-sm">
                        <thead className="sticky top-0 z-10 bg-slate-950/96 text-slate-400 backdrop-blur">
                          <tr>
                            <th className="w-14 px-4 py-3 text-center">选择</th>
                            <th className="px-4 py-3">进程</th>
                            <th className="px-4 py-3">PID</th>
                            <th className="hidden xl:table-cell px-4 py-3">类型</th>
                            <th className="hidden 2xl:table-cell px-4 py-3">程序路径</th>
                            <th className="px-4 py-3">状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inspectResult.processes.map((process, index) => {
                            const checked = selectedPids.includes(process.pid);
                            return (
                              <motion.tr
                                key={process.pid}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.02 }}
                                className={clsx(
                                  'border-t border-white/6 transition',
                                  checked ? 'bg-cyan-400/8' : 'bg-transparent',
                                  process.canKill ? 'hover:bg-white/[0.03]' : 'opacity-75',
                                )}
                              >
                                <td className="px-4 py-3 text-center">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={!process.canKill}
                                    onChange={() => togglePid(process.pid)}
                                    className="h-4 w-4 rounded border-white/15 bg-slate-950/60 accent-cyan-400"
                                  />
                                </td>
                                <td className="px-4 py-3">
                                  <div className="font-medium text-slate-100">{process.name}</div>
                                  <div className="mt-1 xl:hidden text-xs text-slate-500">{process.appType}</div>
                                  {!process.canKill && process.blockReason ? (
                                    <div className="mt-1 text-xs text-amber-200">{process.blockReason}</div>
                                  ) : null}
                                  {process.exePath ? (
                                    <div
                                      className="mt-1 hidden max-w-[420px] truncate text-xs text-slate-500 xl:block 2xl:hidden"
                                      title={process.exePath}
                                    >
                                      {process.exePath}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="px-4 py-3 text-slate-300">{process.pid}</td>
                                <td className="hidden xl:table-cell px-4 py-3 text-slate-300">{process.appType}</td>
                                <td className="hidden 2xl:table-cell px-4 py-3 text-slate-400">
                                  <div
                                    className="max-w-[760px] truncate xl:max-w-[960px]"
                                    title={process.exePath || '未能读取程序路径'}
                                  >
                                    {process.exePath || '未能读取程序路径'}
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  {process.canKill ? (
                                    <span className="label-chip border-emerald-300/20 bg-emerald-400/10 text-emerald-100">
                                      可释放
                                    </span>
                                  ) : (
                                    <span className="label-chip border-amber-300/20 bg-amber-400/10 text-amber-100">
                                      已保护
                                    </span>
                                  )}
                                </td>
                              </motion.tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-white/8 px-3 py-3 sm:px-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
                  <span>
                    当前已选择 <span className="font-semibold text-slate-100">{selectedProcesses.length}</span> 个进程
                  </span>
                  <span className="text-xs text-slate-500">只会结束你勾选的占用进程</span>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:flex sm:flex-wrap">
                  <button
                    onClick={() => setSelectedPids([])}
                    disabled={selectedPids.length === 0}
                    className={clsx(buttonBase, 'w-full bg-white/6 px-3 py-2.5 text-slate-200 hover:bg-white/10 sm:w-auto')}
                  >
                    <X className="h-4 w-4" />
                    清空选择
                  </button>
                  <button
                    onClick={() => setConfirmOpen(true)}
                    disabled={!canRelease}
                    className={clsx(
                      buttonBase,
                      'w-full bg-gradient-to-r from-emerald-400 to-teal-400 px-4 py-2.5 text-slate-950 shadow-lg shadow-emerald-500/20 hover:brightness-110 sm:w-auto',
                    )}
                  >
                    {isReleasing ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <HardDriveDownload className="h-4 w-4" />
                    )}
                    {isReleasing ? '释放中...' : '释放选中进程'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </motion.section>
      </div>

      {confirmOpen ? (
        <motion.div
          className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 190, damping: 20 }}
            className="glass-panel w-full max-w-2xl rounded-[2rem] p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.28em] text-slate-500">执行确认</div>
                <div className="mt-2 text-2xl font-semibold text-white">确认释放选中进程？</div>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  这些进程会被强制结束，文件 / 文件夹会在结束后立即重新扫描。
                </p>
              </div>
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-2xl border border-white/10 bg-white/5 p-2 text-slate-300 transition hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 max-h-[300px] space-y-3 overflow-auto pr-1">
              {selectedProcesses.map((process) => (
                <div
                  key={process.pid}
                  className="surface-panel rounded-2xl border-white/10 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{process.name}</div>
                      <div className="mt-1 text-xs text-slate-400">
                        PID {process.pid} · {process.appType}
                      </div>
                    </div>
                    <span className="label-chip border-emerald-300/20 bg-emerald-400/10 text-emerald-100">
                      将被结束
                    </span>
                  </div>
                  <div
                    className="mt-3 truncate text-xs text-slate-500"
                    title={process.exePath || '未能读取程序路径'}
                  >
                    {process.exePath || '未能读取程序路径'}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setConfirmOpen(false)}
                className={clsx(buttonBase, 'bg-white/6 text-slate-200 hover:bg-white/10')}
              >
                取消
              </button>
              <button
                onClick={() => void handleReleaseConfirmed()}
                className={clsx(
                  buttonBase,
                  'bg-gradient-to-r from-emerald-400 to-teal-400 text-slate-950 shadow-lg shadow-emerald-500/20 hover:brightness-110',
                )}
              >
                <HardDriveDownload className="h-4 w-4" />
                确认释放
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </div>
  );
}

export default App;
