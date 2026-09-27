import { createContext } from 'react';

/** 页面切换方向：1 前进，-1 后退。 */
export const DirectionContext = createContext<1 | -1>(1);
