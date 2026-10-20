package com.example.backend;

import com.example.model.Role;
import com.example.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock
    private UserRepository userRepository;

    @Test
    void rejectsPasswordsLongerThanTheBcryptUtf8Limit() {
        UserService userService = new UserService(userRepository);
        String password = "😀".repeat(19);

        assertFalse(userService.registerUser("test-user", password, Role.OPERATOR));
        assertNull(userService.authenticate("test-user", password));
        verify(userRepository, never()).findByUsername("test-user");
        verify(userRepository, never()).save(org.mockito.ArgumentMatchers.any());
    }
}
