import React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { LegalDocument } from '../../src/components/LegalDocument';
import { legal, LegalDoc } from '../../src/legal';

export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const key = (doc && doc in legal ? doc : 'termsOfService') as LegalDoc;
  return (
    <>
      <Stack.Screen options={{ title: legal[key].title }} />
      <LegalDocument doc={key} />
    </>
  );
}
