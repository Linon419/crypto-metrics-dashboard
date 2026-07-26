import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import ChangePassword from './ChangePassword';

function PasswordChangePrompt() {
  const { isAuthenticated, user } = useSelector(state => state.auth);
  const shouldPrompt = Boolean(isAuthenticated && user?.passwordChangeRecommended);
  // 对外部署由后端强制：此时其他接口全部 403，弹窗不提供关闭入口。
  // 本地一键启动只提示，保持可关闭。
  const mandatory = Boolean(user?.passwordChangeEnforced);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (shouldPrompt) setVisible(true);
  }, [shouldPrompt]);

  if (!shouldPrompt) return null;

  return (
    <ChangePassword
      visible={mandatory ? true : visible}
      mandatory={mandatory}
      onClose={() => setVisible(false)}
    />
  );
}

export default PasswordChangePrompt;
