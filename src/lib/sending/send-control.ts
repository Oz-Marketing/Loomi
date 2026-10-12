// Process-wide "stop sending" switch for a graceful worker shutdown.
//
// A deploy restarts the worker. Killing it mid-send loses the window between
// SendGrid accepting a message and the recipient row being marked `sent`, so
// the next run mails those people again. On SIGTERM the worker flips this
// switch: the send loops stop starting new messages, let the ones already in
// flight finish and be recorded, and only then does the process exit.

let stopRequested = false;

export function requestSendStop(): void {
  stopRequested = true;
}

export function isSendStopRequested(): boolean {
  return stopRequested;
}

/** Test hook. */
export function resetSendStopForTests(): void {
  stopRequested = false;
}
