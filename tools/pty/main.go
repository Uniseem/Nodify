//go:build linux

// nodify-pty owns one Linux PTY. Its parent speaks bounded JSON lines, never shell arguments.
package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
)

type frame struct {
	Type      string `json:"type"`
	Data      string `json:"data"`
	Cols      uint16 `json:"cols"`
	Rows      uint16 `json:"rows"`
	Directory string `json:"directory"`
	Seconds   int    `json:"seconds"`
}

func size(f frame) bool { return f.Cols >= 20 && f.Cols <= 400 && f.Rows >= 5 && f.Rows <= 200 }

// Job control creates several process groups; terminate every process in this PTY's session.
func killSession(id int, sig syscall.Signal) {
	paths, _ := filepath.Glob("/proc/[0-9]*/stat")
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		end := strings.LastIndexByte(string(data), ')')
		if end < 0 {
			continue
		}
		fields := strings.Fields(string(data)[end+1:])
		if len(fields) < 4 || fields[3] != strconv.Itoa(id) {
			continue
		}
		pid, err := strconv.Atoi(filepath.Base(filepath.Dir(path)))
		if err == nil && pid > 1 {
			_ = syscall.Kill(pid, sig)
		}
	}
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--version" {
		fmt.Println("nodify-pty/1")
		return
	}
	// Adopt shell jobs if Bash exits before them, then reap them before the helper exits.
	if _, _, err := syscall.Syscall6(syscall.SYS_PRCTL, 36, 1, 0, 0, 0, 0); err != 0 {
		os.Exit(2)
	}
	input := bufio.NewScanner(os.Stdin)
	input.Buffer(make([]byte, 4096), 32768)
	if !input.Scan() {
		return
	}
	var open frame
	if json.Unmarshal(input.Bytes(), &open) != nil || open.Type != "open" || !size(open) || open.Seconds < 1 || open.Seconds > 1800 {
		os.Exit(2)
	}
	cmd := exec.Command("/bin/bash", "--noprofile", "--norc", "-i")
	cmd.Dir = open.Directory
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + os.Getenv("HOME"), "TERM=xterm-256color", "LANG=C.UTF-8", "HISTFILE=/dev/null", "HISTSIZE=0", "PS1=Nodify:\\w\\$ "}
	terminal, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: open.Cols, Rows: open.Rows})
	if err != nil {
		fmt.Fprintln(os.Stderr, "PTY start failed")
		os.Exit(2)
	}
	var lock sync.Mutex
	output := json.NewEncoder(os.Stdout)
	emit := func(value any) { lock.Lock(); defer lock.Unlock(); _ = output.Encode(value) }
	emit(map[string]any{"type": "ready"})
	var once sync.Once
	closeSession := func() {
		once.Do(func() {
			_ = terminal.Close()
			killSession(cmd.Process.Pid, syscall.SIGHUP)
			time.Sleep(150 * time.Millisecond)
			killSession(cmd.Process.Pid, syscall.SIGKILL)
		})
	}
	defer func() {
		closeSession()
		until := time.Now().Add(time.Second)
		for time.Now().Before(until) {
			var status syscall.WaitStatus
			pid, err := syscall.Wait4(-1, &status, syscall.WNOHANG, nil)
			if err == syscall.ECHILD {
				break
			}
			if pid <= 0 {
				time.Sleep(10 * time.Millisecond)
			}
		}
	}()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)
	timer := time.AfterFunc(time.Duration(open.Seconds)*time.Second, closeSession)
	defer timer.Stop()
	go func() { <-signals; closeSession() }()
	go func() {
		for input.Scan() {
			var f frame
			if json.Unmarshal(input.Bytes(), &f) != nil {
				break
			}
			switch f.Type {
			case "input":
				data, err := base64.StdEncoding.DecodeString(f.Data)
				if err != nil || len(data) > 16384 {
					closeSession()
					return
				}
				if _, err = terminal.Write(data); err != nil {
					return
				}
			case "resize":
				if !size(f) {
					closeSession()
					return
				}
				_ = pty.Setsize(terminal, &pty.Winsize{Cols: f.Cols, Rows: f.Rows})
			case "close":
				closeSession()
				return
			default:
				closeSession()
				return
			}
		}
		closeSession()
	}()
	dataDone := make(chan struct{})
	go func() {
		defer close(dataDone)
		buf := make([]byte, 16384)
		for {
			n, err := terminal.Read(buf)
			if n > 0 {
				emit(map[string]any{"type": "data", "data": base64.StdEncoding.EncodeToString(buf[:n])})
			}
			if err != nil {
				return
			}
		}
	}()
	err = cmd.Wait()
	select {
	case <-dataDone:
	case <-time.After(time.Second):
		closeSession()
		<-dataDone
	}
	code := 0
	if err != nil {
		if e, ok := err.(*exec.ExitError); ok {
			code = e.ExitCode()
		} else {
			code = 1
		}
	}
	emit(map[string]any{"type": "exit", "code": code})
}
