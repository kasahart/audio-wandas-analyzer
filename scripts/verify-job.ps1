# Runs one `npm run verify` step on Windows inside a job object (scripts/verify-runner.mjs starts it; Windows only).
#
# Why: on Windows a process has no process group. A step's tree is found by parent process ids, and once a process
# has exited its children are no longer reachable that way, so a step that exits while a process it started still
# runs would leave that process behind, unseen (and holding the step's output pipes). A job object holds every process
# started inside it, whoever its parent: here the step is created suspended, put in a job that ends all its processes
# when its last handle closes (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE), and only then let run. When the step exits, a
# process still in the job fails the step (as on Linux and macOS, where its process group must be empty) and is ended.
# If verify stops this helper (taskkill /T /F), the job's handle closes with it and the job ends what is in it.
#
# Node cannot create a job object itself, and the repository adds no native code, so the Win32 calls are made from
# the C# below, which PowerShell compiles on the fly (Windows PowerShell 5.1 ships with Windows; nothing to install).
#
# Input (environment, removed before the step starts): AWA_VERIFY_JOB_COMMAND_LINE, the step's command line quoted as
# Windows programs parse it; AWA_VERIFY_JOB_GRACE_MS, how long processes the step leaves may take to exit by
# themselves. The exit code is the step's, or 1 when it left a process running.
$ErrorActionPreference = 'Stop'
$commandLine = $env:AWA_VERIFY_JOB_COMMAND_LINE
$graceMs = [int]$env:AWA_VERIFY_JOB_GRACE_MS
Remove-Item Env:AWA_VERIFY_JOB_COMMAND_LINE
Remove-Item Env:AWA_VERIFY_JOB_GRACE_MS

# Exit code that tells verify the helper could not be set up (scripts/verify-runner.mjs JOB_HELPER_BLOCKED, which
# turns it into a message that says what happened and what to do).
$blocked = 213
# PowerShell's Constrained Language Mode (set by AppLocker, WDAC or a lockdown policy) refuses Add-Type, which this
# helper needs. Said plainly here, rather than as the raw PowerShell error.
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
    $Host.UI.WriteErrorLine('verify-job: PowerShell runs in ' + $ExecutionContext.SessionState.LanguageMode + ' mode, which blocks Add-Type')
    exit $blocked
}

# C# 5: Windows PowerShell 5.1 compiles with it (no string interpolation, no out variables).
$definition = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class AwaVerifyJob
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }

    const int JobObjectBasicAccountingInformation = 1;
    const int JobObjectExtendedLimitInformation = 9;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    const uint CREATE_SUSPENDED = 0x4;
    const int STARTF_USESTDHANDLES = 0x100;
    const uint HANDLE_FLAG_INHERIT = 0x1;
    const uint INFINITE = 0xFFFFFFFF;

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info, int length, IntPtr returnLength);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
        bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int which);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    static void Check(bool ok, string what)
    {
        if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), what);
    }

    /** This process's standard handle, made inheritable so the step writes to the pipes verify reads. */
    static IntPtr Inherited(int which)
    {
        IntPtr handle = GetStdHandle(which);
        if (handle != IntPtr.Zero && handle != new IntPtr(-1)) SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
        return handle;
    }

    static uint Active(IntPtr job)
    {
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info;
        Check(QueryInformationJobObject(job, JobObjectBasicAccountingInformation, out info, Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)), IntPtr.Zero), "QueryInformationJobObject");
        return info.ActiveProcesses;
    }

    public static int Run(string commandLine, int graceMs)
    {
        IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
        Check(job != IntPtr.Zero, "CreateJobObject");
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        Check(SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))), "SetInformationJobObject");

        STARTUPINFO startup = new STARTUPINFO();
        startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        startup.dwFlags = STARTF_USESTDHANDLES;
        startup.hStdInput = Inherited(-10);
        startup.hStdOutput = Inherited(-11);
        startup.hStdError = Inherited(-12);
        PROCESS_INFORMATION process;
        Check(CreateProcessW(null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED, IntPtr.Zero, null, ref startup, out process), "CreateProcess " + commandLine);
        if (!AssignProcessToJobObject(job, process.hProcess))
        {
            int error = Marshal.GetLastWin32Error();
            TerminateProcess(process.hProcess, 1);
            throw new Win32Exception(error, "AssignProcessToJobObject");
        }
        ResumeThread(process.hThread);
        CloseHandle(process.hThread);
        WaitForSingleObject(process.hProcess, INFINITE);
        uint code;
        Check(GetExitCodeProcess(process.hProcess, out code), "GetExitCodeProcess");
        CloseHandle(process.hProcess);

        uint left = Active(job);
        for (int waited = 0; left > 0 && waited < graceMs; waited += 50)
        {
            Thread.Sleep(50);
            left = Active(job);
        }
        if (left > 0)
        {
            Console.Error.WriteLine("verify: the step left " + left + " process(es) running after it exited (they were ended): a step must wait for every process it starts");
            Console.Error.Flush();
            TerminateJobObject(job, 1);
            CloseHandle(job);
            return 1;
        }
        CloseHandle(job);
        return unchecked((int)code);
    }
}
'@
try {
    Add-Type -TypeDefinition $definition
} catch {
    $Host.UI.WriteErrorLine('verify-job: Add-Type failed: ' + $_.Exception.Message)
    exit $blocked
}

exit ([AwaVerifyJob]::Run($commandLine, $graceMs))
