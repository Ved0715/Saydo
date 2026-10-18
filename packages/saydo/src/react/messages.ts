'use client';
import { createContext, useContext } from 'react';
import { defaultMessages, type SaydoMessages } from './strings';

export { defaultMessages, type SaydoMessages };

export const MessagesContext = createContext<SaydoMessages>(defaultMessages);
export const useMessages = () => useContext(MessagesContext);
