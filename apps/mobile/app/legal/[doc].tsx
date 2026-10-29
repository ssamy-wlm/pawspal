import React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { LegalDocument } from '../../src/components/LegalDocument';
import { legal, LegalDoc } from '../../src/legal';
import { Key, t as tr } from '../../src/i18n';

const TITLE: Record<LegalDoc, Key> = {
  termsOfService: 'legal.terms', privacyPolicy: 'legal.privacy', communityGuidelines: 'legal.guidelines',
};

export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const key = (doc && doc in legal ? doc : 'termsOfService') as LegalDoc;
  return (
    <>
      <Stack.Screen options={{ title: tr(TITLE[key]) }} />
      <LegalDocument doc={key} />
    </>
  );
}
