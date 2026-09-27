import { Activity, ArrowRight, Hand } from 'lucide-react';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Penlight } from '../components/Penlight';
import { Reveal, Screen } from '../components/Screen';
import { ThemeToggle } from '../components/ThemeToggle';
import { requestMotionPermission } from '../lib/motion';
import {
  navigate,
  setInputMode,
  setMotionPermission,
  setNickname,
  useStore,
} from '../store';
import styles from './Home.module.css';

export function Home() {
  const nickname = useStore((s) => s.nickname);

  const checkSensor = async () => {
    setInputMode('motion');
    // iOS 只允许在点击回调里申请权限，所以在这里申请，而不是进了自检页再申请。
    setMotionPermission(await requestMotionPermission());
    navigate('sensor');
  };

  const useTap = () => {
    setInputMode('tap');
    navigate('songs');
  };

  return (
    <Screen
      onBack={null}
      headerLeft={<span className={styles.wordmark}>PENLIGHT</span>}
      headerRight={<ThemeToggle />}
      footer={
        <>
          <Button variant="primary" size="lg" block icon={Activity} trailingIcon={ArrowRight} onClick={checkSensor}>
            检测传感器
          </Button>
          <Button variant="ghost" block icon={Hand} onClick={useTap}>
            没有传感器，改用点屏幕
          </Button>
        </>
      }
    >
      <Reveal>
        <Penlight />
      </Reveal>
      <Reveal className={styles.intro}>
        <h1 className={styles.title}>应援棒</h1>
        <p className={styles.lede}>跟着音乐挥动手机，看看你的节奏有多稳。</p>
      </Reveal>
      <Reveal>
        <Field
          label="QQ 昵称"
          placeholder="领奖时用来核对，可以不填"
          value={nickname}
          maxLength={24}
          autoComplete="nickname"
          enterKeyHint="done"
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </Reveal>
      <Reveal className={styles.rules}>
        <ol>
          <li>
            <span className={`${styles.step} num`}>1</span>
            开头 8 拍是热身，不计分
          </li>
          <li>
            <span className={`${styles.step} num`}>2</span>
            之后跟着节奏挥，快慢、动作都随你
          </li>
          <li>
            <span className={`${styles.step} num`}>3</span>
            挥得越稳分越高，乱挥会扣分
          </li>
        </ol>
      </Reveal>
      <Reveal>
        <p className={styles.footnote}>单机版 · 成绩只保存在这台手机上</p>
      </Reveal>
    </Screen>
  );
}
