// Switch between front and rear camera by moving to the next video device.
// Shared by the phone meeting footer and MobileMeeting.
export async function flipCamera(meeting: any): Promise<void> {
  if (!meeting?.self) return;
  try {
    const devices: MediaDeviceInfo[] = await meeting.self.getVideoDevices();
    if (!devices || devices.length < 2) return;
    const current = meeting.self.videoTrack?.getSettings?.()?.deviceId;
    const next = devices.find((d) => d.deviceId !== current) || devices[0];
    await meeting.self.setDevice(next);
  } catch (err) {
    console.error('Flip camera failed:', err);
  }
}
