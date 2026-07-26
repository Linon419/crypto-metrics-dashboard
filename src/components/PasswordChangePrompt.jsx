import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import ChangePassword from './ChangePassword';

function PasswordChangePrompt() {
  const { isAuthenticated, user } = useSelector(state => state.auth);
  const shouldPrompt = Boolean(isAuthenticated && user?.passwordChangeRecommended);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (shouldPrompt) setVisible(true);
  }, [shouldPrompt]);

  if (!shouldPrompt) return null;

  return (
    <ChangePassword
      visible={visible}
      onClose={() => setVisible(false)}
    />
  );
}

export default PasswordChangePrompt;
