import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from 'expo-router';

export function useDirtyFormGuard(dirty: boolean, title: string, message: string, cancel: string, discard: string) {
  const navigation = useNavigation();
  const allowExit = useRef(false);
  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (!dirty || allowExit.current) return;
    event.preventDefault();
    Alert.alert(title, message, [
      { text: cancel, style: 'cancel' },
      { text: discard, style: 'destructive', onPress: () => { allowExit.current = true; navigation.dispatch(event.data.action); } },
    ]);
  }), [cancel, dirty, discard, message, navigation, title]);
  return () => { allowExit.current = true; };
}
