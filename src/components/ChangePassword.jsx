import React, { useState } from 'react';
import { Alert, Button, Form, Input, message, Modal, Space } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { changePassword } from '../services/api';
import { logout } from '../redux/slices/authSlice';

const MIN_PASSWORD_LENGTH = 6;

function ChangePassword({ visible, onClose, mandatory = false }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { user } = useSelector(state => state.auth);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const handleSubmit = async (values) => {
    setError(null);
    setLoading(true);

    try {
      await changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      form.resetFields();
      message.success('密码已修改，请重新登录');
      dispatch(logout());
      navigate('/login', { replace: true });
    } catch (requestError) {
      setError(
        requestError.displayMessage
        || requestError.response?.data?.error
        || requestError.message
        || '密码修改失败，请稍后重试'
      );
    } finally {
      setLoading(false);
    }
  };

  if (!user?.id) {
    return (
      <Modal
        title="修改密码"
        open={visible}
        onCancel={onClose}
        footer={<Button onClick={onClose}>关闭</Button>}
      >
        <Alert
          message="用户信息不可用"
          description="请重新登录后修改密码"
          type="error"
          showIcon
        />
      </Modal>
    );
  }

  return (
    <Modal
      title="修改密码"
      open={visible}
      onCancel={mandatory ? undefined : onClose}
      closable={!mandatory}
      maskClosable={!mandatory}
      keyboard={!mandatory}
      footer={null}
      destroyOnHidden
    >
      {error && (
        <Alert
          message="修改失败"
          description={error}
          type="error"
          showIcon
          className="mb-4"
          closable
          onClose={() => setError(null)}
        />
      )}

      {user?.passwordChangeRecommended && (
        <Alert
          message="请更换初始密码"
          description={mandatory
            ? '当前账号正在使用简易初始密码，其他功能已被暂时锁定。请设置一个不易猜测的新密码（至少6个字符），修改后需要重新登录。'
            : '当前账号正在使用简易初始密码。建议设置一个不易猜测的新密码（至少6个字符），修改后需要重新登录。'}
          type="warning"
          showIcon
          className="mb-4"
        />
      )}

      <Form form={form} name="changePassword" onFinish={handleSubmit} layout="vertical">
        <Form.Item
          name="currentPassword"
          label="当前密码"
          rules={[{ required: true, message: '请输入当前密码' }]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="当前密码" autoComplete="current-password" />
        </Form.Item>

        <Form.Item
          name="newPassword"
          label="新密码"
          extra={`至少${MIN_PASSWORD_LENGTH}个字符，且不能是常见弱密码`}
          rules={[
            { required: true, message: '请输入新密码' },
            { min: MIN_PASSWORD_LENGTH, message: `密码长度至少为${MIN_PASSWORD_LENGTH}个字符` },
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="新密码" autoComplete="new-password" />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请确认新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                return !value || getFieldValue('newPassword') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error('两次输入的密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="确认新密码" autoComplete="new-password" />
        </Form.Item>

        <Form.Item className="mb-0">
          <div className="flex justify-end">
            <Space>
              {!mandatory && <Button onClick={onClose}>取消</Button>}
              <Button type="primary" htmlType="submit" loading={loading}>修改密码</Button>
            </Space>
          </div>
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default ChangePassword;
