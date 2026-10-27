package com.example.backend;

import com.example.model.Role;
import com.example.model.User;
import com.example.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

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

    @Test
    void createsNewRegistrationsAsUnapproved() {
        UserService userService = new UserService(userRepository);
        when(userRepository.findByUsername("new-user")).thenReturn(java.util.Optional.empty());

        assertTrue(userService.registerUser("new-user", "strong-password", Role.OPERATOR));

        org.mockito.ArgumentCaptor<User> userCaptor = org.mockito.ArgumentCaptor.forClass(User.class);
        verify(userRepository).save(userCaptor.capture());
        assertFalse(userCaptor.getValue().isApproved());
        assertEquals(Role.OPERATOR, userCaptor.getValue().getRole());
    }

    @Test
    void refusesToAuthenticateUnapprovedUsers() {
        UserService userService = new UserService(userRepository);
        User pending = new User("pending", org.mindrot.jbcrypt.BCrypt.hashpw(
                "strong-password", org.mindrot.jbcrypt.BCrypt.gensalt()), Role.OPERATOR, false);
        when(userRepository.findByUsername("pending")).thenReturn(java.util.Optional.of(pending));

        assertNull(userService.authenticate("pending", "strong-password"));
    }

    @Test
    void createsDefaultAdminWithBcryptAndAdminRoleWhenMissing() {
        UserService userService = new UserService(userRepository);
        when(userRepository.findByUsername("admin")).thenReturn(java.util.Optional.empty());

        userService.ensureDefaultAdmin();

        org.mockito.ArgumentCaptor<User> userCaptor = org.mockito.ArgumentCaptor.forClass(User.class);
        verify(userRepository).save(userCaptor.capture());
        User admin = userCaptor.getValue();
        assertEquals(Role.ADMIN, admin.getRole());
        assertTrue(admin.isApproved());
        assertTrue(org.mindrot.jbcrypt.BCrypt.checkpw("admin", admin.getPasswordHash()));
    }

    @Test
    void preventsChangingTheMainAdminRole() {
        UserService userService = new UserService(userRepository);
        User admin = new User("admin", "hash", Role.ADMIN, true);
        when(userRepository.findById(1L)).thenReturn(java.util.Optional.of(admin));

        assertTrue(userService.changeApprovedUserRole(1L, Role.USER).isEmpty());
        verify(userRepository, never()).save(admin);
    }
}
