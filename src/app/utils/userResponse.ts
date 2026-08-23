import { IUser } from '../modules/user/user.interface';

export const userResponse = (user: IUser | any) => {
  const { _id, name, email, role } = user;
  return { _id, name, email, role };
};
