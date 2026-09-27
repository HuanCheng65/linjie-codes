import { AnimatePresence, MotionConfig } from 'motion/react';
import { useEffect, type ComponentType } from 'react';
import { DirectionContext } from './components/Direction';
import { Toast } from './components/Toast';
import { syncThemeColorWithPage } from './lib/themeColor';
import { BeatEditor } from './screens/BeatEditor';
import { Home } from './screens/Home';
import { Play } from './screens/Play';
import { Result } from './screens/Result';
import { SensorCheck } from './screens/SensorCheck';
import { SongSelect } from './screens/SongSelect';
import { applyTheme, currentScreen, installHistory, useStore, type Screen } from './store';

const SCREENS: Record<Screen, ComponentType> = {
  home: Home,
  sensor: SensorCheck,
  songs: SongSelect,
  editor: BeatEditor,
  play: Play,
  result: Result,
};

export function App() {
  const screen = useStore(currentScreen);
  const direction = useStore((s) => s.direction);
  const theme = useStore((s) => s.theme);

  useEffect(() => installHistory(), []);

  useEffect(() => {
    applyTheme(theme);
    if (screen !== 'play') syncThemeColorWithPage();
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => screen !== 'play' && syncThemeColorWithPage();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme, screen]);

  const Current = SCREENS[screen];

  return (
    <MotionConfig reducedMotion="user">
      <DirectionContext.Provider value={direction}>
        <div className="stage">
          <AnimatePresence custom={direction}>
            <Current key={screen} />
          </AnimatePresence>
        </div>
      </DirectionContext.Provider>
      <Toast />
    </MotionConfig>
  );
}
