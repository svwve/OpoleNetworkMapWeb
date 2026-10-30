package com.example.backend.controllers;

import com.example.backend.UserService;
import jakarta.servlet.http.HttpSession;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AdminControllerTest {

    private final UserService userService = mock(UserService.class);
    private final AdminController controller = new AdminController(userService);

    @Test
    void deniesDeleteForAdminAccountsThatAreNotTheMainAdmin() {
        HttpSession session = mock(HttpSession.class);
        when(session.getAttribute("username")).thenReturn("secondary-admin");

        var response = controller.deleteUser(10L, session);

        assertEquals(403, response.getStatusCode().value());
        verify(userService, never()).deleteUser(10L, "secondary-admin");
    }

    @Test
    void forwardsMainAdminDeleteToProtectedService() {
        HttpSession session = mock(HttpSession.class);
        when(session.getAttribute("username")).thenReturn("admin");
        when(userService.deleteUser(10L, "admin")).thenReturn(true);

        var response = controller.deleteUser(10L, session);

        assertEquals(200, response.getStatusCode().value());
        verify(userService).deleteUser(10L, "admin");
    }
}
