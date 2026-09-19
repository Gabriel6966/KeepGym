// Internal creation input; hashing belongs to the future authentication module.
export interface CreateUserInput {
  email: string;
  passwordHash: string;
}

export interface PublicUser {
  id: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}
