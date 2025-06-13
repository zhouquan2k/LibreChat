import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useChangePasswordMutation } from 'librechat-data-provider/react-query';
import type { TChangePassword } from 'librechat-data-provider';
import { Button, Input } from '~/components';
import { useLocalize } from '~/hooks';

function ChangePassword() {
  const localize = useLocalize();
  const [showSuccess, setShowSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TChangePassword>();
  
  const newPassword = watch('newPassword');
  const changePassword = useChangePasswordMutation();

  const onSubmit = (data: TChangePassword) => {
    setErrorMessage('');
    setShowSuccess(false);
    
    changePassword.mutate(data, {
      onSuccess: () => {
        setShowSuccess(true);
        setShowForm(false); // 成功后隐藏表单
        reset(); // 清空表单
      },
      onError: (error: any) => {
        setErrorMessage(error.response?.data?.message || '修改密码失败');
      }
    });
  };

  const toggleForm = () => {
    setShowForm(!showForm);
    setShowSuccess(false);
    setErrorMessage('');
    if (!showForm) {
      reset(); // 显示表单时清空之前的输入
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <span>{localize('com_nav_change_password')}</span>
        <Button
          type="button"
          onClick={toggleForm}
          variant="outline"
          size="sm"
        >
          {showForm ? '取消' : '修改密码'}
        </Button>
      </div>
      
      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4 pl-4 border rounded-lg p-4">
          {showSuccess && (
            <div className="mb-4 rounded-md bg-green-50 p-4 dark:bg-green-900/30">
              <div className="flex">
                <div className="text-sm font-medium text-green-800 dark:text-green-400">
                  {localize('com_nav_password_changed_successfully')}
                </div>
              </div>
            </div>
          )}
          
          {errorMessage && (
            <div className="mb-4 rounded-md bg-red-50 p-4 dark:bg-red-900/30">
              <div className="flex">
                <div className="text-sm font-medium text-red-800 dark:text-red-400">
                  {errorMessage}
                </div>
              </div>
            </div>
          )}
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-primary">
              {localize('com_nav_current_password')}
            </label>
            <Input
              type="password"
              {...register('currentPassword', {
                required: localize('com_nav_current_password_required'),
              })}
              placeholder={localize('com_nav_current_password')}
              className="w-full"
            />
            {errors.currentPassword && (
              <p className="text-xs text-red-500">{errors.currentPassword.message}</p>
            )}
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-primary">
              {localize('com_nav_new_password')}
            </label>
            <Input
              type="password"
              {...register('newPassword', {
                required: localize('com_nav_new_password_required'),
                minLength: {
                  value: 8,
                  message: localize('com_auth_password_min_length'),
                },
                maxLength: {
                  value: 128,
                  message: localize('com_auth_password_max_length'),
                },
              })}
              placeholder={localize('com_nav_new_password')}
              className="w-full"
            />
            {errors.newPassword && (
              <p className="text-xs text-red-500">{errors.newPassword.message}</p>
            )}
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-primary">
              {localize('com_nav_confirm_password')}
            </label>
            <Input
              type="password"
              {...register('confirmPassword', {
                required: localize('com_nav_confirm_password_required'),
                validate: (value) => value === newPassword || localize('com_auth_password_not_match'),
              })}
              placeholder={localize('com_nav_confirm_password')}
              className="w-full"
            />
            {errors.confirmPassword && (
              <p className="text-xs text-red-500">{errors.confirmPassword.message}</p>
            )}
          </div>
          
          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full"
          >
            {isSubmitting ? localize('com_nav_changing_password') : localize('com_nav_change_password')}
          </Button>
        </form>
      )}
    </div>
  );
}

export default React.memo(ChangePassword); 