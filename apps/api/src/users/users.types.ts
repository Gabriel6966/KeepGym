// Internal creation input; hashing belongs to Auth, not to the User domain.
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

// Internal authentication data. Never use this type as an HTTP response.
export interface UserCredentials extends PublicUser {
  passwordHash: string;
}
