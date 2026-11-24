import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { HoldButton } from './hold-button';
import { SlideToAcknowledge, slideCompletes } from './slide-to-acknowledge';
import { SwipeRow } from './swipe-row';
import { ToastHost, toast } from './toast';

const activate = { nativeEvent: { actionName: 'activate' } };

describe('SlideToAcknowledge', () => {
  test('the slide counts only past 85% of the knob travel', () => {
    // track 300 wide, 4 padding each side, 56 knob: the knob travels 236, so 85% is 200.6
    expect(slideCompletes(201, 300)).toBe(true);
    expect(slideCompletes(200, 300)).toBe(false);
    expect(slideCompletes(0, 300)).toBe(false);
  });

  test('a tap never acknowledges; the screen-reader activate action does, once', async () => {
    const onAcknowledge = jest.fn().mockResolvedValue(true);
    await render(<SlideToAcknowledge label="Slide to acknowledge" onAcknowledge={onAcknowledge} />);
    const slider = screen.getByRole('adjustable');
    await fireEvent.press(slider);
    expect(onAcknowledge).not.toHaveBeenCalled();
    await fireEvent(slider, 'accessibilityAction', activate);
    await fireEvent(slider, 'accessibilityAction', activate);
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });
});

test('SlideToAcknowledge can be tried again when the acknowledgement fails', async () => {
  const onAcknowledge = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await render(<SlideToAcknowledge label="Slide to acknowledge" onAcknowledge={onAcknowledge} />);
  const slider = screen.getByLabelText('Slide to acknowledge');
  await fireEvent(slider, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
  await fireEvent(slider, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
  expect(onAcknowledge).toHaveBeenCalledTimes(2);
  await fireEvent(slider, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
  expect(onAcknowledge).toHaveBeenCalledTimes(2); // done once it worked
});

describe('HoldButton', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('fires once after a one-second hold, not before', async () => {
    const onFire = jest.fn();
    await render(<HoldButton label="Hold to call Ana" onFire={onFire} />);
    await fireEvent(screen.getByRole('button'), 'pressIn');
    await act(() => jest.advanceTimersByTime(900));
    expect(onFire).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(100));
    expect(onFire).toHaveBeenCalledTimes(1);
    await fireEvent(screen.getByRole('button'), 'pressOut');
    await act(() => jest.advanceTimersByTime(2000));
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Hold the button for a second/)).toBeNull();
  });

  test('letting go early cancels and explains', async () => {
    const onFire = jest.fn();
    await render(<HoldButton label="Hold to call Ana" onFire={onFire} />);
    await fireEvent(screen.getByRole('button'), 'pressIn');
    await act(() => jest.advanceTimersByTime(400));
    await fireEvent(screen.getByRole('button'), 'pressOut');
    await act(() => jest.advanceTimersByTime(2000));
    expect(onFire).not.toHaveBeenCalled();
    expect(screen.getByText('Hold the button for a second. It stops accidental pages.')).toBeTruthy();
  });

  test('the screen-reader activate action fires straight away', async () => {
    const onFire = jest.fn();
    await render(<HoldButton label="Hold to call Ana" onFire={onFire} />);
    await fireEvent(screen.getByRole('button'), 'accessibilityAction', activate);
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});

describe('SwipeRow', () => {
  test('a long press offers the same actions as the swipe', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onAck = jest.fn();
    await render(
      <SwipeRow title="Checkout down" actions={[{ label: 'Acknowledge', tone: 'orange', onPress: onAck }, { label: 'Resolve', tone: 'green', onPress: jest.fn() }]}>
        <></>
      </SwipeRow>,
    );
    await fireEvent(screen.getByLabelText('Checkout down'), 'longPress');
    const buttons = spy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    expect(buttons.map((b) => b.text)).toEqual(['Acknowledge', 'Resolve', 'Cancel']);
    buttons[0].onPress?.();
    expect(onAck).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('toast', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('shows a message and hides it after its duration', async () => {
    await render(<ToastHost />);
    await act(() => toast.show({ text: 'Acknowledged. Paging stopped.' }));
    expect(screen.getByText('Acknowledged. Paging stopped.')).toBeTruthy();
    await act(() => jest.advanceTimersByTime(4100));
    expect(screen.queryByText('Acknowledged. Paging stopped.')).toBeNull();
  });

  test('an Undo toast stays until its deadline and runs the action', async () => {
    const undo = jest.fn();
    await render(<ToastHost />);
    await act(() => toast.show({ text: 'Swapped. You take Dec 25', action: { label: 'Undo', onPress: undo }, until: Date.now() + 10_000 }));
    await act(() => jest.advanceTimersByTime(9000));
    await fireEvent.press(screen.getByText('Undo'));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Swapped. You take Dec 25')).toBeNull();
  });
});
